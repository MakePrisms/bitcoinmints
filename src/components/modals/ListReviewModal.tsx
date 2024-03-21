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

interface FediListingModalBodyProps {
  mintPubkey: string;
  setMintPubkey: (pubkey: string) => void;
  inviteCodes?: string[];
  setInviteCodes?: (codes: string[]) => void;
}

const FediListingModalBody = ({mintPubkey, setMintPubkey, inviteCodes, setInviteCodes}: FediListingModalBodyProps) => (
  <>
    <div>
      <div className="mb-2 block">
        <Label>Mint Pubkey</Label>
      </div>
      <TextInput
        placeholder="ae042fe2b1..."
        id="mint-pubkey"
        value={mintPubkey}
        onChange={(e) => setMintPubkey(e.target.value)}
        required
      />
    </div>
    <div>
      <div className="mb-2 block">
        <Label>Invite Codes</Label>
      </div>
      <Textarea
        placeholder="fedxyz..., fedabc..., fed123..."
        id="invite-codes"
        value={inviteCodes?.join(',')}
        onChange={(e) => setInviteCodes!(e.target.value.split(','))}
      />
    </div>
  </>
)

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
  inviteCodes?: string[];
  setInviteCodes?: (codes: string[]) => void;
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
  inviteCodes,
  setInviteCodes,
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
            {mintType === Nip87MintTypes.Cashu ? "Mint URL" : "Mint Pubkey"}
          </Label>
        </div>
        <TextInput
          placeholder={
            mintType === Nip87MintTypes.Cashu ? "https://mint.example.com" : "ae042fe2b1..."
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
      {
        mintType === Nip87MintTypes.Fedimint && (
          <div>
            <div className="mb-2 block">
              <Label>Invite Codes</Label>
            </div>
            <Textarea
              placeholder="fedxyz..., fedabc..., fed123..."
              id="invite-codes"
              value={inviteCodes?.join(',')}
              onChange={(e) => setInviteCodes!(e.target.value.split(','))}
            />
          </div>
        )
      }
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
  inviteCodes?: string[];
  setInviteCodes?: (codes: string[]) => void;
}

const ListReviewModal = ({
  show,
  onClose,
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
  inviteCodes,
  setInviteCodes,
}: ListReviewModalProps) => {
  const title = type === "review" ? "Review Mint" : "List Mint";
  const submitText = type === "review" ? "Publish Review" : "Publish Listing";
  return (
    <Modal show={show} onClose={onClose} size="md" popup>
      <Modal.Header className="m-3">
        <h3 className="text-2xl font-medium">{title}</h3>
      </Modal.Header>
      <Modal.Body>
        <Tabs style="underline" className="mt-1">
          <Tabs.Item title="Cashu">
            <div className="space-y-6">
              {type === "review" ? (
                <ReviewModalBody
                  mintUrl={mintUrl}
                  setMintUrl={setMintUrl}
                  rating={rating}
                  setRating={setRating}
                  review={review}
                  setReview={setReview}
                  mintType={Nip87MintTypes.Cashu}
                />
              ) : (
                <CashuListingModalBody
                  mintUrl={mintUrl}
                  setMintUrl={setMintUrl}
                />
              )}
            </div>
          </Tabs.Item>
          <Tabs.Item title="Fedimint">
            <div className="space-y-6">
              {type === "review" ? (
                <ReviewModalBody
                  rating={rating}
                  setRating={setRating}
                  review={review}
                  setReview={setReview}
                  mintType={Nip87MintTypes.Fedimint}
                  mintPubkey={mintPubkey}
                  setMintPubkey={setMintPubkey}
                  inviteCodes={inviteCodes}
                  setInviteCodes={setInviteCodes}
                />
              ) : (
                <FediListingModalBody 
                  mintPubkey={mintPubkey}
                  setMintPubkey={setMintPubkey}
                  inviteCodes={inviteCodes}
                  setInviteCodes={setInviteCodes}
                />
              )}
            </div>
          </Tabs.Item>
        </Tabs>
        <div className="w-full">
          <Button isProcessing={isProcessing} onClick={handleSubmit}>
            {submitText}
          </Button>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default ListReviewModal;
