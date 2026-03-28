const fs = require('fs');
const path = require('path');

/**
 * calculate_metrics.js
 * 
 * This script calculates frequency distributions for the 15 Codebook Variables (V0-V14) 
 * from the exported 'output-logs.csv' Google Sheet data.
 * It automatically generates a formatted Markdown table for use in research papers.
 * 
 * Usage: node scripts/calculate_metrics.js
 */

const CSV_FILE_PATH = path.join(__dirname, '../output-logs.csv');

function parseCSV(text) {
  let rows = [];
  let row = [];
  let inQuote = false;
  let val = '';
  
  for(let i = 0; i < text.length; i++) {
    let c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (i < text.length - 1 && text[i+1] === '"') {
          val += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        val += c;
      }
    } else {
      if (c === '"') {
        inQuote = true;
      } else if (c === ',') {
        row.push(val);
        val = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && i < text.length - 1 && text[i+1] === '\n') {
          i++;
        }
        row.push(val);
        rows.push(row);
        row = [];
        val = '';
      } else {
        val += c;
      }
    }
  }
  
  if (val || row.length > 0) {
    row.push(val);
    rows.push(row);
  }
  
  return rows;
}

try {
  const text = fs.readFileSync(CSV_FILE_PATH, 'utf8');
  const rows = parseCSV(text).filter(r => r.length > 2); // Exclude empty rows
  
  if (rows.length === 0) {
    console.error('No data found in output-logs.csv');
    process.exit(1);
  }

  const headers = rows[0].map(h => h.trim());
  const headerMap = {};
  headers.forEach((h, i) => headerMap[h] = i);

  // Initialize counting state for V0-V14
  const counts = {};
  for(let i = 0; i <= 14; i++) { 
    counts['V' + i] = {}; 
  }

  let totalPosts = 0;

  // Tally all row frequencies
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    totalPosts++;
    
    for (let v = 0; v <= 14; v++) {
      const key = 'V' + v;
      let val = row[headerMap[key]]?.trim() || 'N/A';
      
      // Fallbacks if data is missing or empty
      if (val === '' || val === 'N/A') { 
        if(v === 14) val = '0'; // Default V14 MANIP_INT to "None"
        else val = '0';         // Default others to 0
      }
      
      counts[key][val] = (counts[key][val] || 0) + 1;
    }
  }

  // Label dictionaries to make the table human-readable
  const mappings = {
    V0: { name: 'Post Content Type', scales: {'0': 'Usual Post', '1': 'Self-Promo', '2': 'Ad'} },
    V1: { name: 'Platform', scales: {'1': 'X (Twitter)', '2': 'TikTok', '3': 'Instagram', '4': 'YouTube'} },
    V2: { name: 'Post Media Format', scales: {'1': 'Single Image', '2': 'Carousel', '3': 'Video Reel'} },
    V3: { name: 'Sponsorship Disclosure', scales: {'0': 'None', '1': 'Ambiguous/Low', '2': 'Clear/High'} },
    V4: { name: 'Direct Commerce Path', scales: {'0': 'None', '1': 'Present'} },
    V5: { name: 'Scripted Persuasion Pressure', scales: {'0': 'None', '1': 'Present'} },
    V6: { name: 'Trust Exploitation / Blurring', scales: {'0': 'None', '1': 'Present'} },
    V7: { name: 'Lifestyle / Status Framing', scales: {'0': 'None', '1': 'Present'} },
    V8: { name: 'Value / Belief-Based Framing', scales: {'0': 'None', '1': 'Present'} },
    V9: { name: 'Engagement Engineering', scales: {'0': 'None', '1': 'Present'} },
    V10: { name: 'Purchase Prompting', scales: {'0': 'None', '1': 'Present'} },
    V11: { name: 'Production Attention Cue', scales: {'0': 'None', '1': 'Present'} },
    V12: { name: 'Teen Audience Targeting', scales: {'0': 'None', '1': 'Present'} },
    V13: { name: 'Teen-Relevant Risk Product', scales: {'0': 'None', '1': 'Present'} },
    V14: { name: 'Overall Manipulation Intensity', scales: {'0': 'None', '1': 'Low', '2': 'Moderate', '3': 'High'} }
  };

  function getPercentage(count, total) {
    if (!count) return '0.0%';
    return ((count / total) * 100).toFixed(1) + '%';
  }

  // Generate the Markdown Table
  console.log(`### Detailed Output Logs (V0 – V14)\n`);
  console.log(`Calculated from \`output-logs.csv\` (N = ${totalPosts})\n`);
  console.log(`| Variable | Category / Name | Evaluated Distribution |`);
  console.log(`| :--- | :--- | :--- |`);

  for (let v = 0; v <= 14; v++) {
    const key = 'V' + v;
    let mapData = mappings[key];
    let rowDistribution = [];
    
    // Iterate through known scales for this variable
    let knownScales = Object.keys(mapData.scales);
    
    // Sort logic (handle string keys numerically if possible)
    knownScales.sort((a,b) => parseInt(a) - parseInt(b));
    
    // Format each item (e.g., "Ad (28.5%)")
    knownScales.forEach(scaleKey => {
      let count = counts[key][scaleKey] || 0;
      let label = mapData.scales[scaleKey];
      rowDistribution.push(`${label} (${getPercentage(count, totalPosts)})`);
    });

    // Check if there are any undefined scales found in the csv that we didn't map
    for (let actualScale in counts[key]) {
      if (!knownScales.includes(actualScale)) {
        let count = counts[key][actualScale] || 0;
        rowDistribution.push(`Scale ${actualScale} (${getPercentage(count, totalPosts)})`);
      }
    }
    
    let distString = rowDistribution.join(', ');
    
    // Bold V14 line for emphasis
    if (v === 14) {
      console.log(`| **${key}** | **${mapData.name}** | **${distString}** |`);
    } else {
      console.log(`| **${key}** | ${mapData.name} | ${distString} |`);
    }
  }

} catch (err) {
  console.error("Error reading or processing CSV file:", err.message);
}
