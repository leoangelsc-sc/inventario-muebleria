-- =====================================================================
-- Inventario Mueblería · esquema de base de datos para Supabase
-- Pega todo este archivo en Supabase → SQL Editor → Run.
-- Se puede volver a correr: no borra datos.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Catálogo de productos y materiales
-- ini_m / ini_b / ini_t = existencia de arranque en Mueblería, Bodega y Taller
-- ---------------------------------------------------------------------
create table if not exists public.productos (
  codigo      text primary key check (codigo ~ '^[A-Z]{2,4}-[0-9]{3,}$'),
  nombre      text not null unique check (char_length(btrim(nombre)) between 1 and 80),
  tipo        text not null default 'Producto terminado'
              check (tipo in ('Producto terminado', 'Materia prima')),
  categoria   text not null check (char_length(btrim(categoria)) between 1 and 40),
  unidad      text not null default 'pza' check (char_length(btrim(unidad)) between 1 and 12),
  ini_m       numeric not null default 0,
  ini_b       numeric not null default 0,
  ini_t       numeric not null default 0,
  minimo      numeric check (minimo >= 0),
  costo       numeric check (costo >= 0),
  precio      numeric check (precio >= 0),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Movimientos: cada venta, compra, traspaso, ajuste, etc. es un renglón.
-- Nunca se borran ni se editan: si hubo un error se ANULAN.
-- ---------------------------------------------------------------------
create table if not exists public.movimientos (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null default current_date,
  tipo          text not null,
  signo         smallint not null,
  codigo        text not null references public.productos (codigo) on update cascade,
  ubic          char(1) not null check (ubic in ('M', 'B', 'T')),
  destino       char(1) check (destino in ('M', 'B', 'T')),
  cantidad      numeric not null check (cantidad > 0),
  nota          text check (char_length(nota) <= 140),
  usuario       uuid default auth.uid(),
  usuario_email text default (auth.jwt() ->> 'email'),
  creado        timestamptz not null default now(),
  anulado       boolean not null default false,
  anulado_por   text,
  anulado_en    timestamptz,
  constraint tipo_y_signo check (
    case tipo
      when 'Venta'                 then signo = -1
      when 'Consumo en producción' then signo = -1
      when 'Merma / dañado'        then signo = -1
      when 'Ajuste (−)'            then signo = -1
      when 'Compra / recepción'    then signo = 1
      when 'Producción terminada'  then signo = 1
      when 'Devolución de cliente' then signo = 1
      when 'Ajuste (+)'            then signo = 1
      when 'Ajuste por conteo'     then signo in (-1, 1)
      when 'Traspaso'              then signo = 0
      else false
    end
  ),
  constraint traspaso_con_destino check ((tipo = 'Traspaso') = (destino is not null)),
  constraint destino_distinto check (destino is null or destino <> ubic)
);

create index if not exists movimientos_codigo_idx on public.movimientos (codigo);
create index if not exists movimientos_fecha_idx  on public.movimientos (fecha desc, creado desc);

-- ---------------------------------------------------------------------
-- Existencias calculadas: arranque + movimientos no anulados
-- ---------------------------------------------------------------------
create or replace view public.existencias
with (security_invoker = true) as
with deltas as (
  select codigo, ubic as u,
         case when tipo = 'Traspaso' then -cantidad else signo * cantidad end as q
    from public.movimientos where not anulado
  union all
  select codigo, destino as u, cantidad as q
    from public.movimientos where not anulado and tipo = 'Traspaso'
)
select p.codigo,
       p.ini_m + coalesce(sum(d.q) filter (where d.u = 'M'), 0) as m,
       p.ini_b + coalesce(sum(d.q) filter (where d.u = 'B'), 0) as b,
       p.ini_t + coalesce(sum(d.q) filter (where d.u = 'T'), 0) as t
  from public.productos p
  left join deltas d on d.codigo = p.codigo
 group by p.codigo, p.ini_m, p.ini_b, p.ini_t;

-- ---------------------------------------------------------------------
-- Reglas: un movimiento solo puede anularse (una vez); nada más cambia.
-- ---------------------------------------------------------------------
create or replace function public.movimientos_solo_anular()
returns trigger language plpgsql as $$
begin
  if (new.fecha, new.tipo, new.signo, new.codigo, new.ubic, new.destino, new.cantidad,
      new.nota, new.usuario, new.usuario_email, new.creado)
     is distinct from
     (old.fecha, old.tipo, old.signo, old.codigo, old.ubic, old.destino, old.cantidad,
      old.nota, old.usuario, old.usuario_email, old.creado) then
    raise exception 'Los movimientos no se editan. Anúlalo y registra uno nuevo.';
  end if;
  if old.anulado then
    raise exception 'Este movimiento ya estaba anulado.';
  end if;
  if new.anulado then
    new.anulado_en  := now();
    new.anulado_por := coalesce(auth.jwt() ->> 'email', auth.uid()::text, current_user);
  end if;
  return new;
end $$;

drop trigger if exists movimientos_solo_anular on public.movimientos;
create trigger movimientos_solo_anular
  before update on public.movimientos
  for each row execute function public.movimientos_solo_anular();

create or replace function public.productos_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado := now();
  return new;
end $$;

drop trigger if exists productos_actualizado on public.productos;
create trigger productos_actualizado
  before update on public.productos
  for each row execute function public.productos_actualizado();

-- ---------------------------------------------------------------------
-- Seguridad (RLS): solo usuarios con sesión iniciada leen y escriben.
-- Los usuarios los das de alta tú en Authentication → Users.
-- ---------------------------------------------------------------------
alter table public.productos   enable row level security;
alter table public.movimientos enable row level security;

revoke all on public.productos, public.movimientos, public.existencias from anon;
grant select, insert, update on public.productos   to authenticated;
grant select, insert, update on public.movimientos to authenticated;
grant select on public.existencias to authenticated;

drop policy if exists "personal lee productos"      on public.productos;
drop policy if exists "personal crea productos"     on public.productos;
drop policy if exists "personal edita productos"    on public.productos;
drop policy if exists "personal lee movimientos"    on public.movimientos;
drop policy if exists "personal registra movimientos" on public.movimientos;
drop policy if exists "personal anula movimientos"  on public.movimientos;

create policy "personal lee productos"   on public.productos for select to authenticated using (true);
create policy "personal crea productos"  on public.productos for insert to authenticated with check (true);
create policy "personal edita productos" on public.productos for update to authenticated using (true) with check (true);

create policy "personal lee movimientos" on public.movimientos for select to authenticated using (true);
create policy "personal registra movimientos" on public.movimientos for insert to authenticated
  with check (usuario = auth.uid() and anulado = false);
create policy "personal anula movimientos" on public.movimientos for update to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------
-- Tiempo real: que todos vean los cambios al momento
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'productos') then
      alter publication supabase_realtime add table public.productos;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'movimientos') then
      alter publication supabase_realtime add table public.movimientos;
    end if;
  end if;
end $$;
