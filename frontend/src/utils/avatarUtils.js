const colors = [
  { light: "#3498db", dark: "#2980b9" }, // blue
  { light: "#9b59b6", dark: "#8e44ad" }, // purple
  { light: "#e67e22", dark: "#d35400" }, // orange
  { light: "#e74c3c", dark: "#c0392b" }, // red
  { light: "#2ecc71", dark: "#27ae60" }, // green
  { light: "#f1c40f", dark: "#f39c12" }, // yellow
  { light: "#16a085", dark: "#11806a" }, // teal
];

/**
 * Gets a light and dark color pair based on a seed string (e.g. user email)
 * @param {string} seed 
 * @returns {{light: string, dark: string}}
 */
export const getAvatarColorPair = (seed) => {
  if (!seed) return colors[0];
  let sum = 0;
  for (let i = 0; i < seed.length; i++) {
    sum += seed.charCodeAt(i);
  }
  return colors[sum % colors.length];
};

/**
 * Helper to get user initials from name or email
 * @param {string} firstName 
 * @param {string} lastName 
 * @param {string} email 
 * @returns {string}
 */
export const getInitials = (firstName, lastName, email) => {
  const f = firstName?.trim()?.[0] || "";
  const l = lastName?.trim()?.[0] || "";
  if (f || l) return (f + l).toUpperCase();
  if (email) return email[0].toUpperCase();
  return "?";
};
