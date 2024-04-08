export const shortenString = (str: string) => {
  if (str.length < 25) return str;
  return str.slice(0, 20) + "..." + str.slice(-4);
};

export const copyToClipboard = (str: string) => {
  navigator.clipboard.writeText(str);
};

export const calculateSha256 = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
};
