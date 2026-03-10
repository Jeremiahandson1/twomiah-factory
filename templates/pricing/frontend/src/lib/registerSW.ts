export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('SW registered:', registration.scope)
          // Check for updates every hour
          setInterval(() => registration.update(), 60 * 60 * 1000)
        })
        .catch((error) => {
          console.error('SW registration failed:', error)
        })
    })
  }
}
