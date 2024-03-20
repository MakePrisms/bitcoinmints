// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { GetMintInfoResponse } from "@/types";
import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetMintInfoResponse | {error: string;}>,
) {
  // get the query parameter call url
  const { mintUrl } = req.query;
  // fetch the mint info from the mint url
  fetch(`${mintUrl}`, {
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => response.json())
    .then((data) => {
      res.status(200).json(data);
    })
    .catch((error) => {
      res.status(500).json({ error: error.message });
    });
}
