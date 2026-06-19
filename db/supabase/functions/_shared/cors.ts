// Shared CORS headers for browser-facing edge functions.
// For production you can tighten Allow-Origin to your Vercel domain
// (e.g. 'https://ticketing-lime.vercel.app') instead of '*'.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
