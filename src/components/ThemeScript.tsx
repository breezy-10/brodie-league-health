/**
 * Inline script that runs synchronously BEFORE first paint to set the
 * `data-theme` attribute on <html>. Prevents the flash-of-wrong-theme that
 * happens if you wait for React to hydrate.
 *
 * It also mirrors the choice into a cookie so the root layout can render the
 * attribute itself. A value only this script set is lost whenever React
 * re-renders the document (a hydration mismatch anywhere does that), which
 * dropped everyone into light mode on reload.
 */
export function ThemeScript() {
  const code = `
    (function () {
      try {
        var stored = localStorage.getItem('blh-theme');
        var theme = stored || 'dark';
        if (theme !== 'dark' && theme !== 'light') theme = 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        document.cookie = 'blh-theme=' + theme + '; path=/; max-age=31536000; samesite=lax';
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
