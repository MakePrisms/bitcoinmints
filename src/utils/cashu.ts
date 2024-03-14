import { GetMintInfoResponse } from "@/types";

const timeout = (ms: number) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error(`Request timed out after ${ms} ms`));
    }, ms);
  });
};

const fetchWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number
) => {
  return Promise.race([
    fetch(url, options),
    timeout(timeoutMs),
  ]) as Promise<Response>;
};

export const getMintInfo = async (mintUrl: string) => {
  const mintInfo: {
    v0: boolean;
    v1: boolean;
    supportedNuts: string;
    pubkey?: string;
  } = {
    v0: false,
    v1: false,
    supportedNuts: "",
  };

  let nutSet = new Set<number>();
  const fetchAndProcessData = async (
    endpoint: string,
    version: "v0" | "v1"
  ) => {
    console.log("FETCHING", `${mintUrl}/${endpoint}`);
    try {
      const res = await fetchWithTimeout(`${mintUrl}/${endpoint}`, {}, 1000);
      const data = (await res.json()) as GetMintInfoResponse;

      console.log("Mint Info", data);

      mintInfo[version] = data ? true : false;

      let nutNums: number[] = [];
      if (version === "v0") {
        nutNums = data.nuts.map((str) => parseInt(str.split("-")[1], 10));
      } else {
        const nuts = data.nuts as unknown as {
          [key: string]: { supported?: boolean };
        };
        nutNums = Object.keys(nuts)
          .filter((nutNum) => Number(nutNum) > 6 && nuts[nutNum].supported)
          .map(Number);
      }
      console.log("NUT NUMS", nutNums);
      nutNums.forEach((num) => nutSet.add(num));
      data.pubkey && (mintInfo.pubkey = data.pubkey);
    } catch (e) {
      console.error(e);
    }
  };

  await fetchAndProcessData("info", "v0");
  await fetchAndProcessData("v1/info", "v1");

  if (!mintInfo.v0 && !mintInfo.v1) {
    throw new Error(`Mint url ${mintUrl} is offline or invalid.`);
  }

  mintInfo.supportedNuts =Array.from(nutSet).sort((a,b) => a-b).join(",");

  return mintInfo;
};
