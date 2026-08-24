
const drv = getDb(P).query('SELECT id, code FROM industry_driver ORDER BY code').all();
console.log(JSON.stringify(drv));