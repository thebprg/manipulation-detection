require('dotenv').config({ path: '.env.local' });
const url = process.env.GOOGLE_SHEET_SCRIPT_URL;
fetch(url).then(res => res.text()).then(text => {
  console.log("Length of response:", text.length);
  console.log("First 100 chars:", text.substring(0, 100));
}).catch(console.error);
