// Supabase project for login + cloud backup. Both values are meant to be public:
// the database only lets each signed-in user read/write their own row (see supabase/setup.sql).
// Leave empty to run the app without accounts.
export const SUPABASE_URL = 'https://rkpsjkssmfjuavdhayie.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_2z7xQjOY5JLONdZH_Xu1OA_NaKzpeRW';
// Web Push: the public half of the notification key pair (the private half is only in the
// Supabase function's secrets). Empty = no push notifications.
export const VAPID_PUBLIC_KEY = 'BE9uZb2HfSjsbRDUYnrPuxISdvV_bz9Mwqm_WcV-ux-WnfUyBpca1U_FpEMOV8PZ765OgsYAgAcuhj0iJ6DL1WM';
