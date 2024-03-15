export const shortenString = (str: string) => {
  if (str.length < 25) return str;
  return str.slice(0, 20) + "..." + str.slice(-4);
}

export const copyToClipboard = (str: string) => {
  navigator.clipboard.writeText(str);
};