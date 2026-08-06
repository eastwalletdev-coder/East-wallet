# Activity status after Send

Previously both branches set `status: 'pending'` (bug).

Now on successful Send, local activity status is **`confirmed`**.

Re-send once after deploy so new rows get the correct status. Old `localStorage` rows may still say pending until cleared.
