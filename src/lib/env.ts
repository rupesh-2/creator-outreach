import "server-only";

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const env = {
  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => req("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),
  appUrl: () => process.env.APP_URL ?? "http://localhost:3000",
  anthropicKey: () => process.env.ANTHROPIC_API_KEY,
  openaiKey: () => process.env.OPENAI_API_KEY,
  apifyToken: () => process.env.APIFY_TOKEN,
  resendKey: () => process.env.RESEND_API_KEY,
  emailFrom: () => process.env.EMAIL_FROM,
  cronSecret: () => req("CRON_SECRET"),
  unsubscribeSecret: () => req("UNSUBSCRIBE_SECRET"),
};

export const integrations = () => ({
  anthropic: !!process.env.ANTHROPIC_API_KEY,
  openai: !!process.env.OPENAI_API_KEY,
  cerebras: !!process.env.CEREBRAS_API_KEY,
  groq: !!process.env.GROQ_API_KEY,
  gemini: !!process.env.GEMINI_API_KEY,
  openrouter: !!process.env.OPENROUTER_API_KEY,
  mistral: !!process.env.MISTRAL_API_KEY,
  nvidia: !!process.env.NVIDIA_API_KEY,
  custom: !!(process.env.LLM_API_KEY && process.env.LLM_BASE_URL && process.env.LLM_MODEL),
  apify: !!process.env.APIFY_TOKEN,
  resend: !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM,
});
