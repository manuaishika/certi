export type Role = 'super' | 'org_admin' | 'volunteer' | 'affiliate'
export type Module = 'certificates' | 'registration' | 'lifecycle' | 'idpass' | 'attendance' | 'ai' | 'cobrand' | 'whitelabel'

export const MODULES: Module[] = ['certificates', 'registration', 'lifecycle', 'idpass', 'attendance', 'ai', 'cobrand', 'whitelabel']
export const MODULE_LABELS: Record<Module, string> = {
  certificates: 'Certificate Engine', registration: 'Registration Hub', lifecycle: 'Event Lifecycle (online / hybrid)',
  idpass: 'Digital ID Pass', attendance: 'QR Attendance Gate', ai: 'AI Design Engine', cobrand: 'Co-hosts & Sponsors',
  whitelabel: 'White-label & custom domain',
}

export interface Profile { id: string; email: string; name: string; role: Role; org_id: string | null; coupon_code: string | null }
export interface TenantInfo {
  id: string; name: string; logo_url: string; plan: string; plan_name: string; modules: Module[]; wallet: number
  quota: number | null; used: number; branch_allowance: number | null; branches: number
  brand: { app_name?: string; color?: string; hide_branding?: boolean }; watermark: boolean
}
export interface Me { profile: Profile; tenant: TenantInfo | null }

export interface Plan {
  key: string; name: string; price_inr: number; price?: number; period: 'month' | 'event' | 'year'; quota: number | null
  branches: number | null; watermark: boolean; modules: Module[]; ai_enabled: boolean; ai_free: number | null; priority: number
}
export interface BrandItem { name: string; logo: string }

export interface EventRow {
  id: string; org_id: string; title: string; title_hi: string; slug: string; description: string
  mode: 'offline' | 'online' | 'hybrid'; venue: string; lat: number | null; lng: number | null; arrival_info: string
  meeting_url: string; starts_at: string | null; reg_open: boolean; orientation: 'landscape' | 'portrait'
  template: string; bg_url: string; accent: string; cert_title: string; cert_body: string
  signatory: string; signatory_role: string; layout: Record<string, Partial<FieldPos>>
  cohosts: BrandItem[]; sponsors: BrandItem[]; sponsor_label: string
  gate_attendance: boolean; feedback_gate: boolean; approval_required: boolean
}
export interface FieldPos { x: number; y: number; size: number }

export interface Registration {
  id: string; name_en: string; name_hi: string; institution: string; grade: string; mobile: string; email: string
  parent_name: string; attend_mode: 'offline' | 'online'; token: string; status: 'registered' | 'present'
  approved: boolean; cert_id: string | null; cert_revoked: boolean | null
}

export interface RenderData {
  cert_id: string; issued_at: string
  event: Omit<EventRow, 'meeting_url' | 'org_id'>
  person: { name_en: string; name_hi: string; grade: string; institution: string }
  org: { name: string; logo_url: string }
  branch: string | null
  watermark: boolean
}

export interface PublicSettings { overage_inr: number; ai_credits_per_run: number; max_cohosts: number; max_sponsors: number; gateway_mode: 'mock' | 'live'; usd_per_inr: number }
export interface Transaction {
  id: string; kind: string; amount: number; currency: string; credits: number; provider: string
  plan: string; coupon: string; status: string; note: string; created_at: string; provider_ref: string
}
