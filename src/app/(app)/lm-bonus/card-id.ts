// A league manager's card id on LM bonus ("lm-arya-karbakhsh"), shared by the
// server page (the card) and the client links that open it.
export const managerCardId = (name: string) =>
  `lm-${name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
