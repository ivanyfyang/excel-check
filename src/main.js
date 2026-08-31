import './style.css';
import { readFile, readWorkbook, parseAttendance, parseOvertime, parseDateRange } from './parser.js';
import { audit } from './audit.js';
import { render } from './render.js';

const $ = s => document.querySelector(s);

let attWorkbook = null;
let otWorkbook = null;

$('#attFile').addEventListener('change', checkFiles);
$('#otFile').addEventListener('change', checkFiles);

function checkFiles() {
  $('#parseBtn').disabled = !($('#attFile').files.length && $('#otFile').files.length);
}

$('#parseBtn').addEventListener('click', async () => {
  try {
    const [attBuf, otBuf] = await Promise.all([
      readFile($('#attFile').files[0]),
      readFile($('#otFile').files[0]),
    ]);
    attWorkbook = readWorkbook(attBuf);
    otWorkbook = readWorkbook(otBuf);

    const sel = $('#sheetDropdown');
    sel.innerHTML = '';
    attWorkbook.SheetNames.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name.trim();
      sel.appendChild(opt);
    });
    if (attWorkbook.SheetNames.length > 0) {
      sel.value = attWorkbook.SheetNames[attWorkbook.SheetNames.length - 1];
    }
    $('#sheetSelect').style.display = 'flex';
    hideError();
  } catch (e) {
    showError('文件读取失败：' + e.message);
  }
});

$('#auditBtn').addEventListener('click', () => {
  try {
    hideError();
    const sheetName = $('#sheetDropdown').value;
    const employees = parseAttendance(attWorkbook, sheetName);
    const otRecords = parseOvertime(otWorkbook);
    const dateRange = parseDateRange(sheetName);
    const results = audit(employees, otRecords, dateRange);
    render(results);
  } catch (e) {
    showError('审核出错：' + e.message);
    console.error(e);
  }
});

function showError(msg) {
  const el = $('#error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  $('#error-msg').style.display = 'none';
}

const drawer = $('#rulesDrawer');
const overlay = $('#rulesOverlay');

function openDrawer() { drawer.classList.add('open'); overlay.classList.add('open'); }
function closeDrawer() { drawer.classList.remove('open'); overlay.classList.remove('open'); }

$('#rulesFab').addEventListener('click', openDrawer);
$('#drawerClose').addEventListener('click', closeDrawer);
overlay.addEventListener('click', closeDrawer);
