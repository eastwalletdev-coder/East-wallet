# Admin login widget empty (env already set)

## Cause (not "you changed env")
1. **Ref timing** — widget `useEffect` often ran while `widgetContainerRef.current` was still `null` after `signed_out` paint → script never injected → blank area, no error.
2. **NEXT_PUBLIC_*** is baked in at **build**. Changing Vercel env without redeploy leaves old client bundle (or empty).
3. Telegram Login Widget can fail silently if domain is not allowed in BotFather or script is blocked.

## Fix in this patch
- Retry inject via `requestAnimationFrame` + timeouts
- Visible panel for the widget + show `@{BOT_USERNAME}` so you can verify the build saw the env
- English diagnostics

## After deploy checklist
1. Hard refresh `/admin/validator-review`
2. You should see **Bot: @YourBot** under the box
3. Blue **Log in with Telegram** button inside the box
4. BotFather → Bot → **Domain** (Login Widget) includes `thiseast.vercel.app`
5. Prefer external browser if Telegram in-app browser blocks the widget

Overwrite: `src/app/admin/validator-review/page.tsx`
