/**
 * HASHMI TRADERS — Google Apps Script Web App
 *
 * 1. Paste this file into Extensions → Apps Script.
 * 2. Project Settings → Script Properties → add SECRET (same value as Vercel APPS_SCRIPT_TOKEN).
 * 3. Run setup() once and approve permissions.
 * 4. Deploy → New deployment → Web app
 *    Execute as: Me
 *    Who has access: Anyone
 * 5. Copy the /exec URL into Vercel APPS_SCRIPT_URL.
 */

var CHUNK = 49000;
var JSON_TAB = "_JSON";
var BACKUP_FOLDER = "HASHMI TRADERS Backups";
var KEEP_BACKUPS = 30;

function getSecret_() {
  return PropertiesService.getScriptProperties().getProperty("SECRET");
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function unauthorized_() {
  return json_({ error: "unauthorized" });
}

function checkToken_(e, post) {
  var secret = getSecret_();
  if (!secret) return false;
  var token = (e && e.parameter && e.parameter.token) || "";
  if (post && post.token) token = post.token;
  return String(token) === String(secret);
}

function lock_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  return lock;
}

function doGet(e) {
  e = e || { parameter: {} };
  if (!checkToken_(e, null)) return unauthorized_();
  var lock = lock_();
  try {
    var action = (e.parameter.action || "read").toLowerCase();
    if (action === "read") return json_(readDb_());
    return json_({ error: "unknown action" });
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  e = e || {};
  var post = {};
  try {
    if (e.postData && e.postData.contents) post = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: "invalid json" });
  }
  if (!checkToken_(e, post)) return unauthorized_();
  var lock = lock_();
  try {
    var action = (post.action || (e.parameter && e.parameter.action) || "write").toLowerCase();
    if (action === "write") {
      if (!post.db) return json_({ error: "missing db" });
      writeDb_(post.db);
      return json_({ ok: true, db: post.db });
    }
    if (action === "read") return json_(readDb_());
    return json_({ error: "unknown action" });
  } finally {
    lock.releaseLock();
  }
}

function emptyDb_() {
  return {
    version: 2,
    revision: 0,
    updatedAt: null,
    products: [],
    invoices: [],
    purchases: [],
    expenses: [],
    customers: [],
    suppliers: [],
    payments: [],
    returns: [],
    settings: {
      businessName: "HASHMI TRADERS",
      phone: "",
      address: "",
      invoiceFooter: "Thank you for your business.",
    },
  };
}

function readDb_() {
  var ss = SpreadsheetApp.getActive();
  var tab = ss.getSheetByName(JSON_TAB);
  if (!tab || tab.getLastRow() < 2) return { empty: true, db: emptyDb_() };
  var last = tab.getLastRow();
  var values = tab.getRange(2, 1, last - 1, 2).getValues();
  values.sort(function (a, b) {
    return Number(a[0]) - Number(b[0]);
  });
  var json = "";
  for (var i = 0; i < values.length; i++) json += String(values[i][1] || "");
  if (!json) return { empty: true, db: emptyDb_() };
  try {
    var db = JSON.parse(json);
    var empty =
      !(db.products && db.products.length) &&
      !(db.invoices && db.invoices.length) &&
      !(db.customers && db.customers.length);
    return { empty: empty, db: db };
  } catch (err) {
    return { empty: true, db: emptyDb_(), error: "corrupt_json" };
  }
}

function writeDb_(db) {
  var ss = SpreadsheetApp.getActive();
  var tab = ss.getSheetByName(JSON_TAB) || ss.insertSheet(JSON_TAB);
  tab.clear();
  tab.getRange(1, 1, 1, 2).setValues([["chunk", "json"]]);
  var raw = JSON.stringify(db);
  var rows = [];
  var i = 0;
  var n = 0;
  while (i < raw.length) {
    rows.push([n, raw.substring(i, i + CHUNK)]);
    i += CHUNK;
    n++;
  }
  if (rows.length) tab.getRange(2, 1, rows.length, 2).setValues(rows);
  writeReadable_(ss, db);
}

function headers_() {
  return {
    Products: ["id", "code", "name", "category", "purchasePrice", "salePrice", "openingStock", "computedStock", "archived"],
    Customers: ["id", "name", "phone", "address", "archived"],
    Suppliers: ["id", "name", "phone", "address", "archived"],
    Invoices: ["id", "no", "date", "customerId", "discount", "subtotal", "total", "method", "paid", "note"],
    InvoiceItems: ["invoiceId", "invoiceNo", "productId", "name", "qty", "rate", "cost", "lineTotal"],
    Purchases: ["id", "no", "date", "supplierId", "discount", "subtotal", "total", "method", "paid", "note"],
    PurchaseItems: ["purchaseId", "purchaseNo", "productId", "name", "qty", "rate", "cost", "lineTotal"],
    Payments: ["id", "no", "date", "partyType", "partyId", "amount", "method", "reference", "note"],
    Returns: ["id", "no", "date", "type", "partyId", "sourceId", "total", "settlement", "reason"],
    Expenses: ["id", "date", "name", "amount", "method", "note"],
    Settings: ["businessName", "phone", "address", "invoiceFooter", "revision", "updatedAt"],
    "Customer Balances": ["id", "name", "phone", "balance", "kind"],
    "Supplier Balances": ["id", "name", "phone", "balance", "kind"],
  };
}

function sheet_(ss, name, header) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  sh.getRange(1, 1, 1, header.length).setFontWeight("bold");
  return sh;
}

function writeRows_(sh, rows) {
  if (!rows.length) return;
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function paid_(doc) {
  if (!doc || !doc.payment) return 0;
  if (doc.payment.method === "credit") return 0;
  return Number(doc.payment.amount) || 0;
}

function stock_(db, productId) {
  var p = (db.products || []).filter(function (x) {
    return String(x.id) === String(productId);
  })[0];
  if (!p) return 0;
  var qty = Number(p.openingStock) || 0;
  (db.invoices || []).forEach(function (inv) {
    (inv.items || []).forEach(function (it) {
      if (String(it.productId) === String(productId)) qty -= Number(it.qty) || 0;
    });
  });
  (db.purchases || []).forEach(function (pur) {
    (pur.items || []).forEach(function (it) {
      if (String(it.productId) === String(productId)) qty += Number(it.qty) || 0;
    });
  });
  (db.returns || []).forEach(function (ret) {
    (ret.items || []).forEach(function (it) {
      if (String(it.productId) !== String(productId)) return;
      qty += ret.type === "sale" ? Number(it.qty) || 0 : -(Number(it.qty) || 0);
    });
  });
  return qty;
}

function writeReadable_(ss, db) {
  db = db || emptyDb_();
  var h = headers_();
  var products = sheet_(ss, "Products", h.Products);
  writeRows_(
    products,
    (db.products || []).map(function (p) {
      return [p.id, p.code, p.name, p.category, p.purchasePrice, p.salePrice, p.openingStock, stock_(db, p.id), p.archived];
    })
  );
  var customers = sheet_(ss, "Customers", h.Customers);
  writeRows_(
    customers,
    (db.customers || []).map(function (p) {
      return [p.id, p.name, p.phone, p.address, p.archived];
    })
  );
  var suppliers = sheet_(ss, "Suppliers", h.Suppliers);
  writeRows_(
    suppliers,
    (db.suppliers || []).map(function (p) {
      return [p.id, p.name, p.phone, p.address, p.archived];
    })
  );
  var invoices = sheet_(ss, "Invoices", h.Invoices);
  writeRows_(
    invoices,
    (db.invoices || []).map(function (d) {
      return [d.id, d.no, d.date, d.customerId, d.discount, d.subtotal, d.total, (d.payment && d.payment.method) || "", paid_(d), d.note];
    })
  );
  var iitems = [];
  (db.invoices || []).forEach(function (d) {
    (d.items || []).forEach(function (it) {
      iitems.push([d.id, d.no, it.productId, it.name, it.qty, it.rate, it.cost, it.lineTotal]);
    });
  });
  writeRows_(sheet_(ss, "InvoiceItems", h.InvoiceItems), iitems);
  var purchases = sheet_(ss, "Purchases", h.Purchases);
  writeRows_(
    purchases,
    (db.purchases || []).map(function (d) {
      return [d.id, d.no, d.date, d.supplierId, d.discount, d.subtotal, d.total, (d.payment && d.payment.method) || "", paid_(d), d.note];
    })
  );
  var pitems = [];
  (db.purchases || []).forEach(function (d) {
    (d.items || []).forEach(function (it) {
      pitems.push([d.id, d.no, it.productId, it.name, it.qty, it.rate, it.cost, it.lineTotal]);
    });
  });
  writeRows_(sheet_(ss, "PurchaseItems", h.PurchaseItems), pitems);
  writeRows_(
    sheet_(ss, "Payments", h.Payments),
    (db.payments || []).map(function (p) {
      return [p.id, p.no, p.date, p.partyType, p.partyId, p.amount, p.method, p.reference || p.bankName, p.note];
    })
  );
  writeRows_(
    sheet_(ss, "Returns", h.Returns),
    (db.returns || []).map(function (r) {
      return [r.id, r.no, r.date, r.type, r.partyId, r.sourceId, r.total, r.settlement, r.reason];
    })
  );
  writeRows_(
    sheet_(ss, "Expenses", h.Expenses),
    (db.expenses || []).map(function (x) {
      return [x.id, x.date, x.name, x.amount, x.method, x.note];
    })
  );
  writeRows_(sheet_(ss, "Settings", h.Settings), [
    [
      (db.settings && db.settings.businessName) || "",
      (db.settings && db.settings.phone) || "",
      (db.settings && db.settings.address) || "",
      (db.settings && db.settings.invoiceFooter) || "",
      db.revision,
      db.updatedAt,
    ],
  ]);

  var custBal = (db.customers || []).map(function (c) {
    var b = balance_(db, "customer", c.id);
    return [c.id, c.name, c.phone, b, b < 0 ? "Advance" : b > 0 ? "Receivable" : "Settled"];
  });
  writeRows_(sheet_(ss, "Customer Balances", h["Customer Balances"]), custBal);
  var supBal = (db.suppliers || []).map(function (c) {
    var b = balance_(db, "supplier", c.id);
    return [c.id, c.name, c.phone, b, b < 0 ? "Advance" : b > 0 ? "Payable" : "Settled"];
  });
  writeRows_(sheet_(ss, "Supplier Balances", h["Supplier Balances"]), supBal);
}

function balance_(db, type, id) {
  var bal = 0;
  if (type === "customer") {
    (db.invoices || []).forEach(function (inv) {
      if (inv.customerId !== id) return;
      bal += Number(inv.total) || 0;
      if (inv.payment && inv.payment.method !== "advance") bal -= paid_(inv);
    });
    (db.payments || []).forEach(function (p) {
      if (p.partyType === "customer" && p.partyId === id) bal -= Number(p.amount) || 0;
    });
    (db.returns || []).forEach(function (r) {
      if (r.type !== "sale" || r.partyId !== id) return;
      bal -= Number(r.total) || 0;
      if (r.settlement === "cash" || r.settlement === "bank") bal += Number(r.total) || 0;
    });
  } else {
    (db.purchases || []).forEach(function (pur) {
      if (pur.supplierId !== id) return;
      bal += Number(pur.total) || 0;
      if (pur.payment && pur.payment.method !== "advance") bal -= paid_(pur);
    });
    (db.payments || []).forEach(function (p) {
      if (p.partyType === "supplier" && p.partyId === id) bal -= Number(p.amount) || 0;
    });
    (db.returns || []).forEach(function (r) {
      if (r.type !== "purchase" || r.partyId !== id) return;
      bal -= Number(r.total) || 0;
      if (r.settlement === "cash" || r.settlement === "bank") bal += Number(r.total) || 0;
    });
  }
  return Math.round(bal * 100) / 100;
}

function setup() {
  var ss = SpreadsheetApp.getActive();
  var h = headers_();
  Object.keys(h).forEach(function (name) {
    sheet_(ss, name, h[name]);
  });
  if (!ss.getSheetByName(JSON_TAB)) {
    var tab = ss.insertSheet(JSON_TAB);
    tab.getRange(1, 1, 1, 2).setValues([["chunk", "json"]]);
  }
  writeDb_(emptyDb_());
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "dailyBackup") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("dailyBackup").timeBased().everyDays(1).atHour(2).create();
}

function dailyBackup() {
  var ss = SpreadsheetApp.getActive();
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  var name = ss.getName() + " " + Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Karachi", "yyyy-MM-dd");
  var copy = ss.copy(name);
  DriveApp.getFileById(copy.getId()).moveTo(folder);
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) {
    return b.getDateCreated() - a.getDateCreated();
  });
  for (var i = KEEP_BACKUPS; i < files.length; i++) files[i].setTrashed(true);
}
