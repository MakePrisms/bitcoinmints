import { Nip87MintTypes } from "@/types";
import {
  Button,
  Modal,
  TextInput,
  Label,
  Rating,
  Textarea,
  Tabs,
} from "flowbite-react";
import { useEffect, useState } from "react";

interface FedimintListingModalBodyProps {
  mintPubkey?: string;
  setMintPubkey: (pubkey: string) => void;
  inviteCode?: string;
  setInviteCode?: (code: string) => void;
}

const FedimintListingModalBody = ({
  mintPubkey,
  setMintPubkey,
  inviteCode,
  setInviteCode,
}: FedimintListingModalBodyProps) => {
  const [federationMeta, setFederationMeta] = useState<any>(null); // New state for federation meta
  const [showFederationMeta, setShowFederationMeta] = useState<boolean>(false);

  useEffect(() => {
    // Function to fetch federation ID and meta
    const fetchFederationInfo = async (code: string) => {
      try {
        let response = await fetch(`https://fmo.sirion.io/config/${code}/id`);
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        let data = await response.text();
        setMintPubkey(data.replace(/"/g, "")); // Set the mint pubkey as the federation ID, need to remove quotes

        response = await fetch(`https://fmo.sirion.io/config/${code}/meta`);
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        data = await response.json();
        setFederationMeta(data); // Set the entire meta JSON for inspection
      } catch (error) {
        console.error("There was a problem with the fetch operation:", error);
      }
    };
    if (inviteCode) {
      fetchFederationInfo(inviteCode);
    }
  }, [inviteCode, setMintPubkey, setFederationMeta]);

  // Function to view formatted federation meta
  const toggleFederationMeta = () => {
    setShowFederationMeta(!showFederationMeta);
  };

  return (
    <>
      <div>
        <div className="mb-2 block">
          <Label>Invite Code</Label>
        </div>
        <Textarea
          placeholder="fedxyz..."
          id="invite-code"
          value={inviteCode}
          onChange={(e) => {
            const newCode = e.target.value;
            setInviteCode!(newCode);
          }}
        />
        {mintPubkey && (
          <div className="mt-2">
            <Label>Federation ID:</Label>
            <div className="text-sm">{mintPubkey}</div>
          </div>
        )}
        {federationMeta?.federation_name && ( // Display federation name if available
          <div className="mt-2">
            <Label>Federation Name:</Label>
            <div>{federationMeta.federation_name}</div>
          </div>
        )}
        {federationMeta && !showFederationMeta && (
          <div className="mt-2">
            <Button onClick={toggleFederationMeta}>View Federation Meta</Button>
          </div>
        )}
        {showFederationMeta && (
          <div>
            <div className="mt-2">
              <Label>Federation Meta:</Label>
            </div>
            <div
              className="mt-2 p-4 bg-gray-800 rounded text-sm text-white overflow-auto"
              style={{ maxHeight: "400px" }}
            >
              <pre>{JSON.stringify(federationMeta, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

interface CashuListingModalBodyProps {
  mintUrl: string;
  setMintUrl: (url: string) => void;
}

const CashuListingModalBody = ({
  mintUrl,
  setMintUrl,
}: CashuListingModalBodyProps) => (
  <div className="space-y-6">
    <div>
      <div className="mb-2 block">
        <Label>Mint URL</Label>
      </div>
      <TextInput
        placeholder="https://mint.example.com"
        id="mint-url"
        value={mintUrl}
        onChange={(e) => setMintUrl(e.target.value)}
        required
      />
    </div>
  </div>
);

interface ReviewModalBodyProps {
  mintUrl?: string;
  setMintUrl?: (url: string) => void;
  rating?: number;
  setRating?: (rating: number) => void;
  review?: string;
  setReview?: (review: string) => void;
  mintType: Nip87MintTypes;
  mintPubkey?: string;
  setMintPubkey?: (pubkey: string) => void;
  inviteCode?: string;
  setInviteCode?: (code: string) => void;
}

const ReviewModalBody = ({
  mintUrl,
  setMintUrl,
  rating,
  setRating,
  review,
  setReview,
  mintType,
  mintPubkey,
  setMintPubkey,
  inviteCode,
  setInviteCode,
}: ReviewModalBodyProps) => {
  if (mintType === Nip87MintTypes.Cashu) {
    if (mintUrl === undefined || setMintUrl === undefined) {
      throw new Error("mintUrl and setMintUrl are required on type Cashu");
    }
    if (mintPubkey || setMintPubkey) {
      throw new Error(
        "mintPubkey and setMintPubkey are not allowed on type Cashu"
      );
    }
  }
  if (mintType === Nip87MintTypes.Fedimint) {
    if (mintPubkey === undefined || setMintPubkey === undefined) {
      throw new Error(
        "mintPubkey and setMintPubkey are required on type Fedimint"
      );
    }
    if (mintUrl || setMintUrl) {
      throw new Error(
        "mintUrl and setMintUrl are not allowed on type Fedimint"
      );
    }
  }
  return (
    <>
      <div>
        <div className="mb-2 block">
          <Label>
            {mintType === Nip87MintTypes.Cashu
              ? "Mint URL"
              : "Federation Invite Code"}
          </Label>
        </div>
        <TextInput
          placeholder={
            mintType === Nip87MintTypes.Cashu
              ? "https://mint.example.com"
              : "fed1..."
          }
          id="mint-url"
          value={mintType === Nip87MintTypes.Cashu ? mintUrl : mintPubkey}
          onChange={
            mintType === Nip87MintTypes.Cashu
              ? (e) => setMintUrl!(e.target.value)
              : (e) => setMintPubkey!(e.target.value)
          }
          required
        />
      </div>
      {rating !== undefined && setRating ? (
        <div>
          <Label>Rating</Label>
          <Rating className="hover:cursor-pointer">
            {Array.from({ length: 5 }).map((_, idx) => (
              <Rating.Star
                key={idx}
                filled={idx < rating}
                onClick={() => setRating(idx + 1)}
              />
            ))}
          </Rating>
          <p className="text-sm text-gray-500">
            On average, how has the mint performed?
          </p>
        </div>
      ) : null}
      {review !== undefined && setReview ? (
        <div>
          <Label>Review</Label>
          <Textarea
            placeholder="I've been using this mint for a while now and it hasn't rugged me!"
            id="review"
            required
            value={review}
            onChange={(e) => setReview(e.target.value)}
            rows={3}
          />
        </div>
      ) : null}
    </>
  );
};

interface ListReviewModalProps {
  show: boolean;
  onClose: () => void;
  mintType: Nip87MintTypes;
  mintUrl: string;
  setMintUrl: (url: string) => void;
  mintPubkey: string;
  setMintPubkey: (pubkey: string) => void;
  handleSubmit: () => void;
  type: "review" | "claim";
  rating?: number;
  setRating?: (rating: number) => void;
  review?: string;
  setReview?: (review: string) => void;
  isProcessing: boolean;
  inviteCode?: string;
  setInviteCode?: (code: string) => void;
}

const ListReviewModal = ({
  show,
  onClose,
  mintType,
  mintUrl,
  setMintUrl,
  mintPubkey,
  setMintPubkey,
  handleSubmit,
  type,
  rating,
  setRating,
  review,
  setReview,
  isProcessing,
  inviteCode,
  setInviteCode,
}: ListReviewModalProps) => {
  const title = type === "review" ? "Review Mint" : "List Mint";
  const submitText = type === "review" ? "Publish Review" : "Publish Listing";
  return (
    <Modal show={show} onClose={onClose} size="md" popup>
      <Modal.Header className="m-3">
        <h3 className="text-2xl font-medium">{title}</h3>
      </Modal.Header>
      <Modal.Body>
        <div className="space-y-6">
          {mintType === Nip87MintTypes.Cashu ? (
            type === "review" ? (
              <ReviewModalBody
                mintUrl={mintUrl}
                setMintUrl={setMintUrl}
                rating={rating}
                setRating={setRating}
                review={review}
                setReview={setReview}
                mintType={mintType}
              />
            ) : (
              <CashuListingModalBody
                mintUrl={mintUrl}
                setMintUrl={setMintUrl}
              />
            )
          ) : // Fedimint
          type === "review" ? (
            <ReviewModalBody
              rating={rating}
              setRating={setRating}
              review={review}
              setReview={setReview}
              mintType={mintType}
              mintPubkey={mintPubkey}
              setMintPubkey={setMintPubkey}
              inviteCode={inviteCode}
              setInviteCode={setInviteCode}
            />
          ) : (
            <FedimintListingModalBody
              mintPubkey={mintPubkey}
              setMintPubkey={setMintPubkey}
              inviteCode={inviteCode}
              setInviteCode={setInviteCode}
            />
          )}
        </div>
        <div className="w-full mt-6">
          <Button
            isProcessing={isProcessing}
            onClick={handleSubmit}
            disabled={
              mintType === Nip87MintTypes.Cashu ? !mintUrl : !mintPubkey
            }
          >
            {submitText}
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default ListReviewModal;
