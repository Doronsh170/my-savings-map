(() => {
  const dialog = document.getElementById('fundComparison');
  const search = dialog.querySelector('input');
  const picks = dialog.querySelector('.compare-picks');
  const results = dialog.querySelector('.compare-results');
  const output = dialog.querySelector('.compare-output');
  const periods = dialog.querySelector('.compare-period');
  const colors = ['#087c79', '#9750ad', '#b65615'];
  let selected = [];
  let months = 12;

  function sameGroup(a, b) {
    return a._cmpProduct === b._cmpProduct && a._cmpCategory === b._cmpCategory
      && cmpIsComparable(a) && cmpIsComparable(b);
  }

  function commonPerformance(funds, length) {
    if (funds.some(f => !f.report_period || !f.hist_start || !Array.isArray(f.hist_yield))) return null;
    const end = Math.min(...funds.map(f => Number(f.report_period)));
    const start = periodAddJs(end, 1 - length);
    const series = funds.map(f => {
      const offset = monthDiff(f.hist_start, start);
      if (!Number.isInteger(offset) || offset < 0) return null;
      const values = f.hist_yield.slice(offset, offset + length);
      if (values.length !== length || !values.every(Number.isFinite)) return null;
      let factor = 1;
      return [0, ...values.map(value => ((factor *= 1 + value / 100) - 1) * 100)];
    });
    return series.every(Boolean) ? { series, start, end } : null;
  }

  function graph({ series, start, end }) {
    const values = series.flat();
    const low = Math.min(-1, ...values);
    const high = Math.max(1, ...values);
    const x = i => 12 + 476 * i / months;
    const y = value => 12 + 136 * (high - value) / (high - low);
    const paths = series.map((points, i) => '<polyline fill="none" stroke="' + colors[i]
      + '" stroke-width="2.5" points="' + points.map((value, j) => x(j) + ',' + y(value)).join(' ') + '"/>');
    return '<svg viewBox="0 0 500 160" role="img" aria-label="תשואה מצטברת לאורך התקופה. הערכים בסוף התקופה מופיעים בטבלה."><line x1="12" x2="488" y1="'
      + y(0) + '" y2="' + y(0) + '" stroke="#adbebd"/>' + paths.join('')
      + '</svg><div class="compare-dates"><span>' + fmtPeriod(start) + '</span><span>' + fmtPeriod(end) + '</span></div>';
  }

  const pct = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) + '%' : '—';
  function renderOutput() {
    periods.hidden = selected.length < 2;
    if (selected.length < 2) {
      output.textContent = 'בחרו לפחות שני מסלולים להצגת ההשוואה.';
      return;
    }
    const perf = commonPerformance(selected, months);
    const rows = [
      ['תשואה מצטברת לפני דמי ניהול', (_, i) => pct(perf?.series[i].at(-1))],
      ['חשיפה למניות', f => pct(f.stock_pct)],
      ['חשיפה לחו״ל', f => pct(f.foreign_pct)],
      ['חשיפה למט״ח', f => pct(f.fx_pct)],
      ['דמי ניהול ממוצעים מצבירה', f => pct(f.avg_annual_management_fee, 2)],
      ['דמי ניהול אישיים מצבירה', f => pct(userFunds.find(item => item.fund.uid === f.uid)?.managementFee, 2)],
      ['חודש דיווח למסלול', f => fmtPeriod(f.report_period)]
    ];
    if (selected.some(isPensionFund)) {
      rows.splice(-1, 0, ['דמי ניהול ממוצעים מהפקדות', f => pct(f.avg_deposit_fee, 2)],
        ['דמי ניהול אישיים מהפקדות', f => pct(userFunds.find(item => item.fund.uid === f.uid)?.depositFee, 2)]);
    }
    const heading = selected.map((f, i) => '<th scope="col"><span class="compare-dot" style="background:'
      + colors[i] + '"></span>מסלול ' + (i + 1) + '</th>').join('');
    output.innerHTML = (selected.slice(1).some(f => !sameGroup(selected[0], f))
      ? '<p class="compare-note">ההשוואה כוללת מסלולים מקבוצות השוואה שונות.</p>' : '')
      + (perf ? graph(perf) : '<p class="compare-note">אין נתוני תשואה חודשיים מלאים לתקופה משותפת זו.</p>')
      + '<div class="compare-table"><table><thead><tr><th scope="col">מדד</th>' + heading
      + '</tr></thead><tbody>' + rows.map(([label, value]) => '<tr><th scope="row">' + label + '</th>'
        + selected.map((f, i) => '<td>' + value(f, i) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }

  function renderResults() {
    if (selected.length === 3) {
      results.textContent = 'אפשר להסיר מסלול כדי לבחור מסלול אחר.';
      return;
    }
    const query = search.value.trim();
    const terms = normalizeText(query).split(' ').filter(Boolean);
    const available = DATA.filter(f => isSelectableFund(f) && !selected.includes(f));
    const saved = new Set(userFunds.map(item => item.fund.uid));
    const matches = available.filter(f => {
      if (!terms.length) return saved.has(f.uid) || (selected.length && sameGroup(selected[0], f));
      if (/^\d+$/.test(query)) return String(f.fund_id).includes(query);
      const text = [f._searchText, normalizeText([f._brand, f.managing_corp,
        PRODUCT_LABEL[f._product], CMP_CATEGORY_LABEL[f._cmpCategory]].join(' '))].join(' ');
      return terms.every(term => text.includes(term));
    });
    const score = f => (String(f.fund_id) === query ? 8 : 0)
      + (selected.length && sameGroup(selected[0], f) ? 4 : 0) + (saved.has(f.uid) ? 2 : 0);
    matches.sort((a, b) => score(b) - score(a));
    if (!matches.length) {
      results.textContent = terms.length ? 'לא נמצאו מסלולים תואמים.' : 'הקלידו כדי למצוא מסלול במאגר.';
      return;
    }
    results.innerHTML = matches.slice(0, 8).map(f => '<button type="button" data-compare-add="'
      + escapeHtml(f.uid) + '"><strong>' + escapeHtml(f.fund_name) + '</strong><small>'
      + escapeHtml([f._brand, PRODUCT_LABEL[f._product], 'קופה ' + f.fund_id].join(' · '))
      + (saved.has(f.uid) ? ' · בחסכונות שלך' : '') + '</small></button>').join('');
    if (matches.length > 8) results.insertAdjacentHTML('beforeend', '<small>מוצגות 8 מתוך ' + matches.length + ' התאמות. אפשר למקד את החיפוש.</small>');
  }

  function render() {
    picks.innerHTML = selected.map((f, i) => '<div><span class="compare-dot" style="background:'
      + colors[i] + '"></span><span><strong>מסלול ' + (i + 1) + ' · ' + escapeHtml(f.fund_name)
      + '</strong><small>' + escapeHtml([f._brand, PRODUCT_LABEL[f._product], 'קופה ' + f.fund_id].join(' · '))
      + '</small></span><button type="button" data-compare-remove="' + i + '">הסרה</button></div>').join('');
    search.disabled = selected.length === 3;
    renderResults();
    renderOutput();
  }

  document.addEventListener('click', event => {
    const open = event.target.closest('[data-compare-open]');
    if (!open) return;
    const fund = DATA.find(f => String(f.uid) === open.dataset.compareOpen && isSelectableFund(f));
    selected = fund ? [fund] : [];
    search.value = '';
    dialog.showModal();
    render();
    search.focus();
  });
  search.addEventListener('input', renderResults);
  dialog.addEventListener('click', event => {
    const add = event.target.closest('[data-compare-add]');
    const remove = event.target.closest('[data-compare-remove]');
    const period = event.target.closest('[data-months]');
    if (add) {
      const fund = DATA.find(f => String(f.uid) === add.dataset.compareAdd && isSelectableFund(f));
      if (!fund || selected.includes(fund) || selected.length >= 3) return;
      selected.push(fund);
      search.value = '';
      render();
      (search.disabled ? picks.querySelector('button') : search).focus();
    } else if (remove) {
      selected.splice(Number(remove.dataset.compareRemove), 1);
      render();
      search.focus();
    } else if (period) {
      months = Number(period.dataset.months);
      periods.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button === period)));
      renderOutput();
    }
  });
})();
