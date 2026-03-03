(async () => {
  const { createRequire } = await import('module');
  const { pathToFileURL } = await import('url');
  const { existsSync } = await import('fs');

  const yf = await import('yahoo-finance2');
  const mod = yf.default || yf;
  if (mod.suppressNotices) mod.suppressNotices(['yahooSurvey']);
  if (mod.setGlobalConfig) mod.setGlobalConfig({ validation: { logErrors: false, logOptionsErrors: false } });

  // First call - causes fetch, fails
  try { await mod.quoteSummary('MSFT', { modules: ['price'] }, { validateResult: false }); }
  catch(e) {}

  // Second call - measure time. If stuck: ~0ms. If retries: >0ms
  const times = [];
  for (let i=0; i<5; i++) {
    const t = Date.now();
    try { await mod.quoteSummary('MSFT', { modules: ['price'] }, { validateResult: false }); }
    catch(e) {}
    times.push(Date.now()-t);
  }
  console.log('Times before clear (should all be ~0ms if stuck):', times);
  // If promise is stuck, all return instantly via the cached rejected promise

  // Now clear
  const _req = createRequire(pathToFileURL(process.cwd() + '/package.json').href);
  const yf2CjsPath = _req.resolve('yahoo-finance2');
  const esmPath = yf2CjsPath.replace('/dist/cjs/', '/dist/esm/').replace('index-node.js', 'lib/getCrumb.js');
  const crumbMod = await import(pathToFileURL(esmPath).href);
  await crumbMod.getCrumbClear(mod._opts.cookieJar);
  console.log('Cleared');

  // After clear - first call should be >0ms (starts a new fetch)
  // Second call should be 0ms (same promise, in-flight dedup)
  const t0 = Date.now(); 
  try { await mod.quoteSummary('MSFT', { modules: ['price'] }, { validateResult: false }); }
  catch(e) {}
  const firstAfter = Date.now()-t0;
  
  // Clear again
  await crumbMod.getCrumbClear(mod._opts.cookieJar);

  // Measure 5 more calls after clear
  const times2 = [];
  for (let i=0; i<5; i++) {
    const t = Date.now();
    try { await mod.quoteSummary('MSFT', { modules: ['price'] }, { validateResult: false }); }
    catch(e) {}
    times2.push(Date.now()-t);
    // Clear between each to avoid re-sticking
    if (i < 4) await crumbMod.getCrumbClear(mod._opts.cookieJar);
  }
  console.log('First after clear:', firstAfter + 'ms');
  console.log('Times after clear (each cleared between):', times2);
  console.log('');
  console.log('VERDICT: If before-times are all 0ms and after-times are all >0ms =>');
  console.log('  getCrumbClear WORKS and the two are the same module instance');
  console.log('  before avg:', (times.reduce((a,b)=>a+b,0)/times.length).toFixed(1) + 'ms');
  console.log('  after avg:', (times2.reduce((a,b)=>a+b,0)/times2.length).toFixed(1) + 'ms');
})();
