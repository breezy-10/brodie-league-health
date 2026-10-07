import { LEGACY_THEME_STORAGE_KEY, THEME_COOKIE } from "@/lib/theme-shared";

// The server renders the theme from a cookie, so for almost everyone this does
// nothing. It exists for one migration: someone who chose a theme with the old
// toggle, which kept it in localStorage. Their choice is applied before paint
// and written to the cookie, after which the server renders it and this goes
// quiet. Anyone who never chose gets the kit's light theme.
export function ThemeScript() {
  const code = `(function(){try{
var c=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)/);
if(c)return;
var t=localStorage.getItem('${LEGACY_THEME_STORAGE_KEY}');
if(t!=='light'&&t!=='dark')return;
document.documentElement.setAttribute('data-theme',t);
document.cookie='${THEME_COOKIE}='+t+'; path=/; max-age=31536000; samesite=lax';
}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
