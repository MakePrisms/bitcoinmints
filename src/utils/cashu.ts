import { GetMintInfoResponse, MintData, V0NutData, V1NutData } from "@/types";

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
  timeoutMs: number,
) => {
  return Promise.race([
    fetch(url, options),
    timeout(timeoutMs),
  ]) as Promise<Response>;
};

export const getMintInfo = async (mintUrl: string): Promise<MintData> => {
  const data: MintData = {
    url: mintUrl,
    v0: false,
    v1: false,
    supportedNuts: "",
    name: "",
    units: [],
  };

  let nutSet = new Set<number>();
  const fetchAndProcessData = async (
    endpoint: string,
    version: "v0" | "v1",
  ) => {
    try {
      const res = await fetchWithTimeout(
        `/api/mintinfo?mintUrl=${encodeURIComponent(`${mintUrl}/${endpoint}`)}`,
        {},
        10_000,
      );
      const mintInfo = (await res.json()) as GetMintInfoResponse;

      if (res.status !== 200) {
        throw new Error(`Request failed with status ${res.status}`);
      }

      data[version] = mintInfo ? true : false;

      let nutNums: number[] = [];
      if (version === "v0") {
        const nuts = mintInfo.nuts as V0NutData;
        nutNums = nuts.map((str) => parseInt(str.split("-")[1], 10));
        data.name = mintInfo.name;
      } else {
        const nuts = mintInfo.nuts as V1NutData;
        nutNums = Object.keys(nuts)
          .filter((nutNum) => Number(nutNum) > 6 && nuts[nutNum].supported)
          .map(Number);

        data.name = mintInfo.name || data.name;
      }
      nutNums.forEach((num) => nutSet.add(num));
      data.pubkey && (data.pubkey = data.pubkey);
    } catch (e) {
      console.error(e);
    }
  };

  await fetchAndProcessData("info", "v0");
  await fetchAndProcessData("v1/info", "v1");

  if (!data.v0 && !data.v1) {
    throw new Error(`Mint url ${mintUrl} is offline or invalid.`);
  }

  data.supportedNuts = Array.from(nutSet)
    .sort((a, b) => a - b)
    .join(",");

  const keysetsRes = await fetchWithTimeout(
    `api/mintkeys?mintUrl=${mintUrl}`,
    {},
    10_000
  );

  const keysets = (await keysetsRes.json()) as any;

  if (keysetsRes.status === 200) {
    console.log(keysets);
    const seenUnits = new Set<string>();
    keysets.keysets.forEach((keyset: any) => {
      if (keyset.unit && !seenUnits.has(keyset.unit)) {
        data.units.push(keyset.unit);
        seenUnits.add(keyset.unit);
      }
    });
  }

  return data;
};
