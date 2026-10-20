-- RepoScope — seed data.
--
-- Three organizations, each with a project and analyses in different states, so
-- the dashboard cannot be correct unless row-level security is doing the
-- filtering. The rows are fixed-identity and conflict-tolerant, so this file is
-- safe to run more than once. Nothing creates a real analysis yet, which is why
-- the rows are seeded by hand.

insert into public.organizations (id, name, slug) values
  ('org_3KXESa919tqTTSLAmXEfWMIWxTj', 'Asifahmed''s Organization', 'asifahmed-s-organization-1791695512875324863'),
  ('org_3KYBvE0kaQPw5moNvNHa870a4Df', 'Northwind Labs', 'northwind-labs-1791724849349336026'),
  ('org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', 'demo', 'demo-1791726582260954395')
on conflict (id) do update set name = excluded.name, slug = excluded.slug;

insert into public.projects (id, organization_id, name, repo_url, default_branch) values
  ('10000000-0000-4000-8000-000000000001', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', 'code-atlas', 'https://github.com/AsifAhmedSahil/Code-Atlas---Codebase-Intelligence-Application', 'main'),
  ('10000000-0000-4000-8000-000000000002', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', 'checkout-web', 'https://github.com/northwind-labs/checkout-web', 'main')
on conflict (id) do nothing;

insert into public.analyses (id, organization_id, project_id, status, started_at, finished_at, created_at) values
  ('20000000-0000-4000-8000-000000000001', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '10000000-0000-4000-8000-000000000001', 'complete', now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours'),
  ('20000000-0000-4000-8000-000000000002', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '10000000-0000-4000-8000-000000000001', 'failed',   now() - interval '30 minutes', now() - interval '29 minutes', now() - interval '30 minutes'),
  ('20000000-0000-4000-8000-000000000003', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '10000000-0000-4000-8000-000000000002', 'running',  now() - interval '5 minutes', null, now() - interval '5 minutes'),
  ('20000000-0000-4000-8000-000000000004', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '10000000-0000-4000-8000-000000000002', 'queued',   null, null, now() - interval '1 minute')
on conflict (id) do nothing;

insert into public.files (id, organization_id, analysis_id, path) values
  ('30000000-0000-4000-8000-000000000001', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', 'app/checkout/page.tsx'),
  ('30000000-0000-4000-8000-000000000002', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', 'app/checkout/Cart.tsx'),
  ('30000000-0000-4000-8000-000000000003', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', 'app/api/checkout/route.ts'),
  ('30000000-0000-4000-8000-000000000004', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '20000000-0000-4000-8000-000000000003', 'src/pages/Checkout.tsx'),
  ('30000000-0000-4000-8000-000000000005', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '20000000-0000-4000-8000-000000000003', 'src/lib/pricing.ts')
on conflict (id) do nothing;

insert into public.edges (id, organization_id, analysis_id, source_file_id, target_file_id, kind) values
  ('40000000-0000-4000-8000-000000000001', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'import'),
  ('40000000-0000-4000-8000-000000000002', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', 're-export'),
  ('40000000-0000-4000-8000-000000000003', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000005', 'import')
on conflict (id) do nothing;

insert into public.routes (id, organization_id, analysis_id, file_id, framework, kind, path, method) values
  ('50000000-0000-4000-8000-000000000001', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'nextjs', 'page', '/checkout', null),
  ('50000000-0000-4000-8000-000000000002', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'nextjs', 'api', '/api/checkout', 'POST'),
  ('50000000-0000-4000-8000-000000000003', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', 'react-router', 'page', '/checkout', null)
on conflict (id) do nothing;

insert into public.explanations (id, organization_id, analysis_id, subject_kind, subject_id, body) values
  ('60000000-0000-4000-8000-000000000001', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', 'file', '30000000-0000-4000-8000-000000000001', 'The checkout page composes the cart and posts to the checkout API route.'),
  ('60000000-0000-4000-8000-000000000002', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '20000000-0000-4000-8000-000000000003', 'file', '30000000-0000-4000-8000-000000000004', 'The Checkout screen reads every price from the pricing library.')
on conflict (id) do nothing;

insert into public.file_roles (id, organization_id, analysis_id, file_id, role) values
  ('70000000-0000-4000-8000-000000000001', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'page'),
  ('70000000-0000-4000-8000-000000000002', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', 'component'),
  ('70000000-0000-4000-8000-000000000003', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'api'),
  ('70000000-0000-4000-8000-000000000004', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000004', 'page'),
  ('70000000-0000-4000-8000-000000000005', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000005', 'util')
on conflict (id) do nothing;

insert into public.insights (id, organization_id, analysis_id, file_id, kind, title, detail) values
  ('80000000-0000-4000-8000-000000000001', 'org_3KXESa919tqTTSLAmXEfWMIWxTj', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000003', 'single-caller', 'API route has one caller', 'Only /checkout imports this route.'),
  ('80000000-0000-4000-8000-000000000002', 'org_3KYBvE0kaQPw5moNvNHa870a4Df', '20000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000005', 'high-fan-in', 'Pricing is widely imported', 'Three modules depend on pricing.ts.')
on conflict (id) do nothing;

-- The "demo" organization, created later, so it exercises the empty-to-filled
-- path and a third set of rows the other two policies must not leak into.
insert into public.projects (id, organization_id, name, repo_url, default_branch) values
  ('10000000-0000-4000-8000-000000000010', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', 'demo-app', 'https://github.com/demo-org/demo-app', 'main')
on conflict (id) do nothing;

insert into public.analyses (id, organization_id, project_id, status, started_at, finished_at, created_at) values
  ('20000000-0000-4000-8000-000000000010', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '10000000-0000-4000-8000-000000000010', 'complete', now() - interval '3 hours', now() - interval '2 hours', now() - interval '3 hours'),
  ('20000000-0000-4000-8000-000000000011', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '10000000-0000-4000-8000-000000000010', 'running',  now() - interval '4 minutes', null, now() - interval '4 minutes')
on conflict (id) do nothing;

insert into public.files (id, organization_id, analysis_id, path) values
  ('30000000-0000-4000-8000-000000000010', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', 'src/app/page.tsx'),
  ('30000000-0000-4000-8000-000000000011', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', 'src/lib/api.ts'),
  ('30000000-0000-4000-8000-000000000012', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', 'src/app/api/hello/route.ts')
on conflict (id) do nothing;

insert into public.edges (id, organization_id, analysis_id, source_file_id, target_file_id, kind) values
  ('40000000-0000-4000-8000-000000000010', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000011', 'import'),
  ('40000000-0000-4000-8000-000000000011', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000011', '30000000-0000-4000-8000-000000000012', 're-export')
on conflict (id) do nothing;

insert into public.routes (id, organization_id, analysis_id, file_id, framework, kind, path, method) values
  ('50000000-0000-4000-8000-000000000010', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000010', 'nextjs', 'page', '/', null),
  ('50000000-0000-4000-8000-000000000011', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000012', 'nextjs', 'api', '/api/hello', 'GET')
on conflict (id) do nothing;

insert into public.explanations (id, organization_id, analysis_id, subject_kind, subject_id, body) values
  ('60000000-0000-4000-8000-000000000010', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', 'file', '30000000-0000-4000-8000-000000000010', 'The home page calls the hello API through the shared client.')
on conflict (id) do nothing;

insert into public.file_roles (id, organization_id, analysis_id, file_id, role) values
  ('70000000-0000-4000-8000-000000000010', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000010', 'page'),
  ('70000000-0000-4000-8000-000000000011', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000011', 'util'),
  ('70000000-0000-4000-8000-000000000012', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000012', 'api')
on conflict (id) do nothing;

insert into public.insights (id, organization_id, analysis_id, file_id, kind, title, detail) values
  ('80000000-0000-4000-8000-000000000010', 'org_3KYFQz5kZ8eDMtQ2HYzzIoMd3wx', '20000000-0000-4000-8000-000000000010', '30000000-0000-4000-8000-000000000011', 'high-fan-in', 'Shared client is widely imported', 'The API client is imported by the home page and the route handler.')
on conflict (id) do nothing;
