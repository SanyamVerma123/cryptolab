/**
 * supabase.ts — Supabase Client, Auth Helpers & Cloud Database Operations
 *
 * Connects Trade Pro to Supabase for multi-device cross-login:
 * - User authentication (Sign Up, Sign In, Sign Out, Password Reset)
 * - User settings, Alpaca API keys, trades, paper balance, and indicators cloud sync
 * - Drawings remain 100% strictly local in the browser per user requirement.
 */

import { createClient, type User, type Session, type AuthError } from "@supabase/supabase-js";

export const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string) || "https://qfzhavrneaqsoowmifay.supabase.co";

export const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmemhhdnJuZWFxc29vd21pZmF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1ODY1NDcsImV4cCI6MjEwNjE2MjU0N30.K4Ll6sTNEkBa91RbhgPV1EVKkvcIAoGvtHGwynYL1f4";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type { User, Session, AuthError };

/** Sign up a new user with email and password */
export async function signUp(email: string, password: string): Promise<{ user: User | null; session: Session | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
  });
  return { user: data.user, session: data.session, error };
}

/** Sign in an existing user with email and password */
export async function signIn(email: string, password: string): Promise<{ user: User | null; session: Session | null; error: AuthError | null }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  return { user: data.user, session: data.session, error };
}

/** Sign out the current user */
export async function signOut(): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.signOut();
  return { error };
}

/** Send password reset email */
export async function resetPassword(email: string): Promise<{ error: AuthError | null }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: window.location.origin,
  });
  return { error };
}

/** Get the currently logged-in user */
export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Subscribe to auth state changes (login, logout, token refresh) */
export function onAuthStateChange(callback: (user: User | null, session: Session | null) => void): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null, session);
  });
  return () => {
    subscription.unsubscribe();
  };
}
