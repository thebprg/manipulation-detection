const fs = require('fs');

function parseCSV(text) {
  let rows = [];
  let row = [];
  let inQuote = false;
  let val = '';
  for(let i=0; i<text.length; i++) {
    let c = text[i];
    if(inQuote) {
      if(c === '"') {
        if(i < text.length - 1 && text[i+1] === '"') {
          val += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        val += c;
      }
    } else {
      if(c === '"') {
        inQuote = true;
      } else if (c === ',') {
        row.push(val);
        val = '';
      } else if (c === '\n' || c === '\r') {
        if(c === '\r' && i < text.length - 1 && text[i+1] === '\n') i++;
        row.push(val);
        rows.push(row);
        row = [];
        val = '';
      } else {
        val += c;
      }
    }
  }
  if(val || row.length > 0) {
    row.push(val);
    rows.push(row);
  }
  return rows;
}

const text = fs.readFileSync('output-logs.csv', 'utf8');
const rows = parseCSV(text).filter(r => r.length > 2);
const headers = rows[0].map(h => h.trim());
let headerMap = {};
headers.forEach((h, i) => headerMap[h] = i);

let metrics = { v3_yes: 0, v5_yes: 0, v6_yes: 0, v11_yes: 0, v14_none: 0, v14_low: 0, v14_mod: 0, v14_high: 0 };
let total = 0;

for(let i=1; i<rows.length; i++) {
  const row = rows[i];
  const v14_val = row[headerMap['V14']]?.trim() || '0';
  let v14 = parseInt(v14_val);
  if(isNaN(v14)) v14 = 0;

  if (v14 === 0) metrics.v14_none++;
  else if (v14 === 1) metrics.v14_low++;
  else if (v14 === 2) metrics.v14_mod++;
  else if (v14 === 3) metrics.v14_high++;

  if(row[headerMap['V3']]?.trim() === '1') metrics.v3_yes++;
  if(row[headerMap['V5']]?.trim() === '1') metrics.v5_yes++;
  if(row[headerMap['V6']]?.trim() === '1') metrics.v6_yes++;
  if(row[headerMap['V11']]?.trim() === '1') metrics.v11_yes++;
  
  total++;
}

console.log('Total analyzed rows:', total);
console.log(JSON.stringify(metrics, null, 2));
