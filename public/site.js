// Copy buttons. Everything else on the site works without JavaScript.
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-copy]')
  if (!button) return
  try {
    await navigator.clipboard.writeText(button.dataset.copy)
    const label = button.textContent
    button.textContent = 'Copied'
    button.dataset.done = ''
    setTimeout(() => { button.textContent = label; delete button.dataset.done }, 2000)
  } catch {
    button.textContent = 'Select and copy it by hand'
  }
})
// Close the phone menu with Escape or a tap outside it.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') document.querySelectorAll('details.nav-mobile[open]').forEach((d) => d.removeAttribute('open'))
})
document.addEventListener('click', (event) => {
  document.querySelectorAll('details.nav-mobile[open]').forEach((d) => { if (!d.contains(event.target)) d.removeAttribute('open') })
})
