/* Presentation only. Original controls, handlers and project state are retained. */
(() => {
  const page = document.getElementById('renderPage');
  const panel = page.querySelector('.render-left');
  panel.id = 'renderInspector';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'button subtle inspector-toggle';
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-expanded', 'true');
  toggle.textContent = '收起参数';
  page.querySelector('.render-heading').append(toggle);
  toggle.addEventListener('click', () => {
    const collapsed = page.classList.toggle('inspector-collapsed');
    panel.hidden = collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? '展开参数' : '收起参数';
    if (!collapsed && matchMedia('(max-width: 900px)').matches) {
      panel.scrollIntoView({ block: 'start' });
    }
  });

  const advanced = document.createElement('details');
  advanced.className = 'advanced-prompts';
  const summary = document.createElement('summary');
  summary.textContent = '高级提示词';
  advanced.append(summary);
  const negative = page.querySelector('.negative-block');
  negative.before(advanced);
  advanced.append(negative, page.querySelector('.builtin-rules'));

  // A panel toggle changes canvas width without necessarily resizing the body.
  // Repaint only existing previews; no geometry, camera or rendering settings change.
  let pending = 0;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      if (!page.hidden && typeof draw === 'function') draw();
    });
  });
  observer.observe(document.getElementById('resultWrap'));
  observer.observe(document.getElementById('previewCanvas').parentElement);
})();
