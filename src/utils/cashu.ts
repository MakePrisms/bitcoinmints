import { GetMintInfoResponse, V0NutData, V1NutData } from "@/types";

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
    name: string;
    pubkey?: string;
  } = {
    v0: false,
    v1: false,
    supportedNuts: "",
    name: "",
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

      if (res.status !== 200) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      console.log("Mint Info", data);

      mintInfo[version] = data ? true : false;

      let nutNums: number[] = [];
      if (version === "v0") {
        const nuts = data.nuts as V0NutData;
        nutNums = nuts.map((str) => parseInt(str.split("-")[1], 10));
        mintInfo.name = data.name;
      } else {
        const nuts = data.nuts as V1NutData;
        nutNums = Object.keys(nuts)
          .filter((nutNum) => Number(nutNum) > 6 && nuts[nutNum].supported)
          .map(Number);

        mintInfo.name = data.name || mintInfo.name;
      }
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

  mintInfo.supportedNuts = Array.from(nutSet)
    .sort((a, b) => a - b)
    .join(",");

  return mintInfo;
};
