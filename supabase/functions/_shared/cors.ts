export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-api-key, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra } })
export const preflight = (req: Request) => (req.method === 'OPTIONS' ? new Response('ok', { headers: corsHeaders }) : null)
