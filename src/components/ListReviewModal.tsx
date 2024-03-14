import { Button, Modal, TextInput, Label, Rating } from "flowbite-react";

interface ListReviewModalProps {
  show: boolean;
  onClose: () => void;
  mintUrl: string;
  setMintUrl: (url: string) => void;
  handleSubmit: () => void;
  type: "review" | "claim";
  rating?: number;
  setRating?: (rating: number) => void;
  review?: string;
  setReview?: (review: string) => void;
}

const ListReviewModal = ({
  show,
  onClose,
  mintUrl,
  setMintUrl,
  handleSubmit,
  type,
  rating,
  setRating,
  review,
  setReview,
}: ListReviewModalProps) => {
  const title = type === "review" ? "Review Mint" : "List Mint";
  const submitText = type === "review" ? "Publish Endorsement" : "Publish Listing";
  return (
    <Modal show={show} onClose={onClose} size="md" popup>
      <Modal.Header />
      <Modal.Body>
        <div className="space-y-6">
          <h3 className="text-2xl font-medium">{title}</h3>
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
          {
            (review !== undefined && setReview) ? (
              <div>
              <Label>Review</Label>
              <TextInput
                placeholder="I've been using this mint for a while now and it's been great!"
                id="review"
                required
                value={review}
                onChange={(e) => setReview(e.target.value)}
              />
            </div>
            ) : null
          }
          <div className="w-full">
            <Button onClick={handleSubmit}>{submitText}</Button>
          </div>
        </div>
      </Modal.Body>
    </Modal>
  );
};

export default ListReviewModal;
