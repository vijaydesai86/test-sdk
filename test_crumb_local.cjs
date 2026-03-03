(async () => {
  const { createRequire } = await import('module');
  const { pathToFileURL } = await import('url');
  const { existsSync } = await import('fs');

  // 1. Load yf2 via dynamic import
  const yf = await import('yahoo-finance2');
  const mod = yf.default || yf;
  if (mod.suppressNotices) mod.suppressNotices(['yahooSurvey']);
  if (mod.setGlobalConfig) mod.setGlobalConfig({ validation: { logErrors: false, logOptionsErrors: false } });
  console.log('yf2 loaded');

  // 2. First call
  try { await mod.quoteSummary('MSFT', { modules: ['price'] }, { validateResult: false }); }
  catch(e) { console.log('First fail:', e.message?.slice(0,80)); }

  // 3. Second call - instant if stuck
  const t0 = Date.now();
  try { await mod.quoteSummary('MSFT', { modules: ['price'] }, { validateResult: false }); }
  catch(e) {
    const ms = Date.now()-t0;
    console.log('Second fail (' + ms + 'ms):', e.message?.slice(0,60));
    console.log(ms < 50 ? '>>> CONFIRMED promise is stuck' : '>>> Retried normally');
  }

  // 4. Resolve getCrumb ESM path
  const _req = createRequire(pathToFileURL(process.cwd() + '/package.json').href);
  const yf2CjsPath = _req.resolve('yahoo-finance2');
  const esmGetCrumbPath = yf2CjsPath
    .replace('/dist/cjs/', '/dist/esm/')
    .replace('index-node.js', 'lib/getCrumb.js');
  console.log('ESM getCrumb path exists?', existsSync(esmGetCrumbPath));

  const crumbMod = await import(pathToFileURL(esmGetCrumbPath).href);
  console.log('getCrumbClear exported?', typeof crumbMod.getCrumbClear);

  const jar = mod._opts?.cookieJar;
  console.log('cookieJar accessible:', !!jar);
  if (crumbMod.getCrumbClear && jar) {
    await crumbMod.getCrumbClear(jar);
    console.log('getCrumbClear called');
  }

  // 5. After clear
  const t1 = Date.now();
  try { await mod.quoteSummary('MSFT', { modules: ['price'] }, { validateResult: false }); }
  catch(e) {
    const ms = Date.now() - t1;
    console.log('After-clear (' + ms + 'ms):', e.message?.slice(0,80));
    console.log(ms < 50 ? '>>> BROKEN: shared singleton NOT cleared' : '>>> WORKS: shared singleton cleared');
  }
})();
