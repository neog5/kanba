import { NextRequest, NextResponse } from 'next/server';
import { SELF_HOSTED } from '@/lib/plan';
import { stripe } from '@/lib/stripe';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Create a Supabase client with service role for server-side operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  if (SELF_HOSTED) {
    return NextResponse.json({ error: 'Billing is disabled' }, { status: 404 });
  }
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      console.error('❌ No Stripe signature found');
      return NextResponse.json(
        { error: 'No signature found' },
        { status: 400 }
      );
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error('❌ STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      );
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error: any) {
      console.error(`❌ Webhook signature verification failed: ${error.message}`);
      return NextResponse.json(
        { error: `Webhook signature verification failed: ${error.message}` },
        { status: 400 }
      );
    }

    console.log(`🎯 Processing webhook event: ${event.type}`);

    // Handle the event
    await handleStripeEvent(event);

    return NextResponse.json({ received: true });

  } catch (error: any) {
    console.error('💥 Webhook error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

async function handleStripeEvent(event: Stripe.Event) {
  const stripeData = event?.data?.object ?? {};

  if (!stripeData || !('customer' in stripeData)) {
    console.log('⏭️ Skipping event - no customer data');
    return;
  }

  const { customer: customerId } = stripeData;

  if (!customerId || typeof customerId !== 'string') {
    console.error(`❌ Invalid customer ID in event: ${JSON.stringify(event)}`);
    return;
  }

  console.log(`👤 Processing event for customer: ${customerId}`);

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await handleSubscriptionChange(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.payment_succeeded':
      await handleInvoicePaymentSucceeded(event.data.object as Stripe.Invoice);
      break;

    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
      break;

    default:
      console.log(`⏭️ Unhandled event type: ${event.type}`);
  }
}

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  console.log(`💳 Checkout session completed: ${session.id}`);
  
  const { customer: customerId, mode, payment_status } = session;

  if (!customerId || typeof customerId !== 'string') {
    console.error('❌ No customer ID in checkout session');
    return;
  }

  if (mode === 'subscription') {
    console.log('🔄 Subscription checkout completed, syncing customer data...');
    await syncCustomerFromStripe(customerId);
  } else if (mode === 'payment' && payment_status === 'paid') {
    console.log('💰 One-time payment completed');
    
    // Handle one-time payment
    const {
      id: checkout_session_id,
      payment_intent,
      amount_subtotal,
      amount_total,
      currency,
    } = session;

    const { error: orderError } = await supabaseAdmin
      .from('stripe_orders')
      .insert({
        checkout_session_id,
        payment_intent_id: payment_intent as string,
        customer_id: customerId,
        amount_subtotal: amount_subtotal || 0,
        amount_total: amount_total || 0,
        currency: currency || 'usd',
        payment_status: payment_status || 'paid',
        status: 'completed',
      });

    if (orderError) {
      console.error('❌ Error saving order:', orderError);
    } else {
      console.log('✅ Order saved successfully');
    }
  }
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  console.log(`🔄 Subscription ${subscription.status}: ${subscription.id}`);
  
  const customerId = subscription.customer as string;
  await syncCustomerFromStripe(customerId);
}

async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  console.log(`✅ Invoice payment succeeded: ${invoice.id}`);
  
  if (invoice.subscription) {
    const customerId = invoice.customer as string;
    await syncCustomerFromStripe(customerId);
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log(`❌ Invoice payment failed: ${invoice.id}`);
  
  if (invoice.subscription) {
    const customerId = invoice.customer as string;
    await syncCustomerFromStripe(customerId);
  }
}

async function syncCustomerFromStripe(customerId: string) {
  try {
    console.log(`🔄 Syncing customer data for: ${customerId}`);

    // Fetch latest subscription data from Stripe
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      status: 'all',
      expand: ['data.default_payment_method'],
    });

    console.log(`📊 Found ${subscriptions.data.length} subscriptions for customer ${customerId}`);

    if (subscriptions.data.length === 0) {
      console.log(`❌ No subscriptions found for customer: ${customerId}`);
      
      // Update subscription record
      const { error: noSubError } = await supabaseAdmin
        .from('stripe_subscriptions')
        .upsert(
          {
            customer_id: customerId,
            status: 'not_started',
          },
          {
            onConflict: 'customer_id',
          }
        );

      if (noSubError) {
        console.error('❌ Error updating subscription status:', noSubError);
        throw new Error('Failed to update subscription status in database');
      }

      // Update user profile to free status
      await updateUserSubscriptionStatus(customerId, 'free');
      return;
    }

    // Process the most recent subscription
    const subscription = subscriptions.data[0];
    console.log(`📋 Processing subscription ${subscription.id} with status: ${subscription.status}`);

    // Update subscription record
    const subscriptionData: any = {
      customer_id: customerId,
      subscription_id: subscription.id,
      price_id: subscription.items.data[0].price.id,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end,
      status: subscription.status,
    };

    // Add payment method info if available
    if (subscription.default_payment_method && typeof subscription.default_payment_method !== 'string') {
      subscriptionData.payment_method_brand = subscription.default_payment_method.card?.brand ?? null;
      subscriptionData.payment_method_last4 = subscription.default_payment_method.card?.last4 ?? null;
    }

    const { error: subError } = await supabaseAdmin
      .from('stripe_subscriptions')
      .upsert(subscriptionData, {
        onConflict: 'customer_id',
      });

    if (subError) {
      console.error('❌ Error syncing subscription:', subError);
      throw new Error('Failed to sync subscription in database');
    }

    console.log(`✅ Successfully synced subscription for customer: ${customerId}`);

    // Update user's subscription status in profiles table
    const userSubscriptionStatus = subscription.status === 'active' ? 'pro' : 'free';
    await updateUserSubscriptionStatus(customerId, userSubscriptionStatus);

  } catch (error) {
    console.error(`❌ Failed to sync subscription for customer ${customerId}:`, error);
    throw error;
  }
}

async function updateUserSubscriptionStatus(customerId: string, status: 'free' | 'pro') {
  try {
    console.log(`👤 Updating user subscription status to: ${status} for customer: ${customerId}`);

    // Find the user_id from the stripe_customers table
    const { data: customerData, error: customerError } = await supabaseAdmin
      .from('stripe_customers')
      .select('user_id')
      .eq('customer_id', customerId)
      .is('deleted_at', null)
      .single();

    if (customerError || !customerData) {
      console.error('❌ Error finding user for customer:', customerError);
      throw new Error(`Failed to find user for customer ${customerId}`);
    }

    console.log(`👤 Found user ${customerData.user_id} for customer ${customerId}`);

    // Update the user's subscription status in the profiles table
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        subscription_status: status,
        updated_at: new Date().toISOString()
      })
      .eq('id', customerData.user_id);

    if (profileError) {
      console.error('❌ Error updating user profile:', profileError);
      throw new Error(`Failed to update profile for user ${customerData.user_id}`);
    }

    console.log(`✅ Successfully updated user ${customerData.user_id} subscription status to: ${status}`);

  } catch (error) {
    console.error(`❌ Failed to update user subscription status:`, error);
    throw error;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Stripe-Signature',
    },
  });
}