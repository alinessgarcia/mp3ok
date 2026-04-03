# Auditoria de seguranca tecnica - MP3OK

Base: `tmp-audit-pdf.txt` + codigo atual do repositorio.

## Vulnerabilidades criticas

1. Token de sessao vazando em URL
- `frontend/src/app/page.tsx:142-153` adiciona `access_token` na query string para downloads e EventSource.
- O helper e reutilizado em varios call sites do mesmo arquivo, incluindo `frontend/src/app/page.tsx:537`, `823`, `859`, `908`, `924`, `1814` e `1975`.
- `backend/src/auth.js:32-41` aceita `access_token` via query.
- Impacto: o JWT pode aparecer em historico do navegador, logs de proxy, referers, ferramentas de monitoramento e capturas de erro. Isso expande muito a superficie de roubo de sessao.
- Risco pratico: qualquer token que saia do header e entre na URL deixa de ser um segredo bem controlado.

2. RLS ausente nas tabelas do feed
- `scripts/supabase-news-schema.sql:1-16` cria `music_news` e `collector_heartbeat`, mas nao habilita RLS nem define policies.
- Impacto: se algum cliente usar o anon key direto no banco, ou se uma rota futura expor acesso direto, as tabelas ficam sem isolamento no nivel de linha.
- `collector_heartbeat` e especialmente sensivel porque revela estado interno do coletor e metadados operacionais.
- O backend usa `SUPABASE_SERVICE_ROLE_KEY`, o que contorna RLS; por isso a ausencia de policies nao protege o backend e nao deve ser vista como controle de seguranca.

## Problemas medios

- CORS aberto em `backend/src/index.js` com `app.use(cors())` sem allowlist.
- `POST /api/news/refresh` permite refresh sem token interno se `ALLOW_UNAUTH_NEWS_REFRESH=true` for setado por engano em producao.
- O arquivo local `.env.local` contem `SUPABASE_SERVICE_ROLE_KEY` e `NEXT_PUBLIC_*`; isso e aceitavel apenas como segredo local, mas e um ativo de alto risco se for copiado para outro ambiente ou commitado.
- `AUTH_REQUIRED` cai para `true` apenas em producao; qualquer preview/staging mal configurado pode expor a API sem auth.

## Melhorias recomendadas

- Remover `access_token` da URL e usar:
  - cookie HttpOnly + SameSite, ou
  - URL assinada de curtissima duracao gerada no backend, ou
  - proxy de download sem repassar o JWT para o browser.
- Restringir CORS para os origins reais do frontend em Netlify e localhost.
- Manter `NEWS_REFRESH_TOKEN` obrigatorio em producao e deixar `ALLOW_UNAUTH_NEWS_REFRESH=false`.
- Tratar `SUPABASE_SERVICE_ROLE_KEY` como segredo do backend apenas. Nunca usar em frontend, Edge Function publica ou variavel `NEXT_PUBLIC_*`.
- Se houver acesso direto ao Supabase pelo cliente no futuro, criar views/RPCs separadas e policies por permissao minima.
- Manter logs sem headers sensiveis e sem query strings completas em erros.

## O que esta correto

- O backend faz validacao de JWT no servidor com `supabase.auth.getUser(token)` em `backend/src/auth.js`.
- O frontend usa `NEXT_PUBLIC_SUPABASE_ANON_KEY`, nao o service role.
- `backend/src/newsService.js` reduz o conteudo das noticias para texto limpo, deduplica por `source_url` e, nesta entrega, foi endurecido para aceitar apenas URLs `http/https`.
- O frontend renderiza titulo, resumo e tags como texto React normal, sem `dangerouslySetInnerHTML`.
- `backend/src/thumbnailProcessor.js:127-156` ja bloqueia URLs invalidas, protocolos nao HTTP/HTTPS e IPs privados na importacao remota.
- `backend/src/downloader.js` e o pipeline de arquivos usam `toSafeContentDisposition`, o que reduz risco de header injection via nome de arquivo.

## Correcoes recomendadas

1. Aplicar o SQL de RLS fornecido em `docs/supabase-rls-news-heartbeat.sql`.
2. Aplicar o padrao de variaveis de ambiente:
   - Render backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_REQUIRED=true`, `NEWS_REFRESH_TOKEN`, `ALLOW_UNAUTH_NEWS_REFRESH=false`.
   - Netlify frontend: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_BASE_URL`.
3. Trocar o transporte de auth para algo que nao grave JWT em URL.
4. Manter o coletor de noticias com allowlist de feeds RSS confiaveis.
5. Se o banco for acessado diretamente pelo frontend em algum momento, publicar apenas views read-only e policies minimalistas.

## Nota final

**5/10**

Motivo: ha protecoes reais no backend, mas dois pontos de alto impacto ainda dominam o risco pratico:
- token em URL;
- RLS ausente nas tabelas do feed.

O patch desta entrega reduz um vetor de RSS malicioso, mas nao resolve os problemas estruturais acima.
