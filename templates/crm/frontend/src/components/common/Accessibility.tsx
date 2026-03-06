import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

// Skip Link - Allows keyboard users to skip navigation
export function SkipLink({ targetId = 'main-content', children = 'Skip to main content' }) {
  return (
    <a
      href={`#${targetId}`}
      className="
        sr-only focus:not-sr-only
        focus:fixed focus:top-4 focus:left-4 focus:z-[100]
        focus:px-4 focus:py-2 focus:bg-orange-500 focus:text-white
        focus:rounded-lg focus:shadow-lg focus:outline-none
        focus:ring-2 focus:ring-orange-300 focus:ring-offset-2
      "
    >
      {children}
    </a>
  );
}

// Focus trap for modals and dialogs
export function FocusTrap({ children, active = true }) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!active || !containerRef.current) return;

    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();

    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [active]);

  return <div ref={containerRef}>{children}</div>;
}

// Announce route changes to screen readers
export function RouteAnnouncer() {
  const location = useLocation();
  const announcerRef = useRef(null);

  useEffect(() => {
    // Get page title from document or generate from path
    const getPageTitle = () => {
      const path = location.pathname;
      if (path === '/') return 'Dashboard';
      return path.slice(1).split('-').map(w => 
        w.charAt(0).toUpperCase() + w.slice(1)
      ).join(' ');
    };

    if (announcerRef.current) {
      announcerRef.current.textContent = `Navigated to ${getPageTitle()}`;
    }
  }, [location]);

  return (
    <div
      ref={announcerRef}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    />
  );
}

// Live region for dynamic updates
export function LiveRegion({ message, type = 'polite' }) {
  return (
    <div
      role="status"
      aria-live={type}
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

// Visually hidden but accessible
export function VisuallyHidden({ children, as: Component = 'span' }) {
  return (
    <Component className="sr-only">
      {children}
    </Component>
  );
}

// Focus visible outline
export const focusStyles = `
  focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2
`;

// Screen reader only text
export const srOnly = 'sr-only';

export default {
  SkipLink,
  FocusTrap,
  RouteAnnouncer,
  LiveRegion,
  VisuallyHidden,
  focusStyles,
  srOnly,
};
