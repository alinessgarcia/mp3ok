# Checklist de secrets e env

## Regra principal

- `SUPABASE_SERVICE_ROLE_KEY` fica somente no backend.
- Nenhuma variavel `SUPABASE_SERVICE_ROLE_KEY` deve existir no Netlify, no browser ou em qualquer `NEXT_PUBLIC_*`.
- Se algum segredo sair de `backend/.env.local` ou `.env.local` e for compartilhado, assuma comprometimento e rotacione.

## Render - backend

- Definir `SUPABASE_URL`.
- Definir `SUPABASE_SERVICE_ROLE_KEY`.
- Definir `AUTH_REQUIRED=true`.
- Definir `NEWS_REFRESH_TOKEN` com valor forte e aleatorio.
- Manter `ALLOW_UNAUTH_NEWS_REFRESH=false`.
- Definir `NEWS_TABLE=music_news` e `NEWS_HEARTBEAT_TABLE=collector_heartbeat` apenas se houver override real.
- Definir limites de upload e fila de forma coerente com o ambiente.
- Rever logs para nao imprimir query strings com token.
- Restringir `CORS` para o origin do frontend, se o deploy final for fixo.

## Netlify - frontend

- Definir `NEXT_PUBLIC_SUPABASE_URL`.
- Definir `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Definir `NEXT_PUBLIC_API_BASE_URL` apontando para o backend do Render.
- Nao definir service role.
- Nao expor tokens de admin em variaveis `NEXT_PUBLIC_*`.
- Revisar preview deploys para manter os mesmos valores publicos e nunca inserir segredo privado neles.

## Supabase

- Aplicar `docs/supabase-rls-news-heartbeat.sql`.
- Confirmar que `music_news` tem RLS ligado e policy read-only para `authenticated`.
- Confirmar que `collector_heartbeat` nao tem policy publica.
- Usar `service_role` somente no backend para upsert do coletor e leitura do heartbeat.
- Rever se algum outro cliente precisa de acesso direto; se precisar, criar uma view ou RPC especifica.

## Sinais de alerta

- `access_token` na URL.
- `SERVICE_ROLE` em frontend, preview, logs ou tickets.
- `ALLOW_UNAUTH_NEWS_REFRESH=true` em producao.
- `AUTH_REQUIRED=false` fora de ambiente local.
- `SUPABASE_URL` ou `SUPABASE_ANON_KEY` copiados junto com o service role em arquivos de compartilhamento.

## Recomendacao operacional

- `backend/.env.local` e `.env.local` devem continuar fora do git.
- Antes de publicar qualquer novo ambiente, conferir variaveis na UI do provedor e nao apenas no arquivo local.
- Se existir duvida sobre exposicao de segredo, rotacionar as chaves antes do go-live.
