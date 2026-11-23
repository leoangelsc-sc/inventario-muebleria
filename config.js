// Conexión con tu proyecto de Supabase.
// Los dos datos están en Supabase → Project Settings → API (o "Connect").
// La clave "anon" / "publishable" es pública por diseño: la seguridad la dan
// el inicio de sesión y las reglas (RLS) de la base de datos.
// NUNCA pongas aquí la clave "service_role" / "secret".
window.INVENTARIO_CONFIG = {
  url: "",      // ej. "https://abcdefghijkl.supabase.co"
  anonKey: ""   // ej. "eyJhbGciOi..." o "sb_publishable_..."
};
