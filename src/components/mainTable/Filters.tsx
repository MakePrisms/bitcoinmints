import { RootState } from "@/redux/store";
import { Checkbox, RangeSlider } from "flowbite-react";
import { useEffect } from "react";
import { useSelector } from "react-redux";

interface FiltersProps {
  minReviews: number;
  minRating: number;
  onlyFriends: boolean;
  showCashu: boolean;
  showFedimint: boolean;
  showFilters: boolean;
  setMinReviews: (minReviews: number) => void;
  setMinRating: (minRating: number) => void;
  setOnlyFriends: (onlyFriends: boolean) => void;
  setShowCashu: (showCashu: boolean) => void;
  setShowFedimint: (showFedi: boolean) => void;
  setShowFilters: (showFilters: boolean) => void;
}

const MintFilters = ({
  minReviews,
  minRating,
  onlyFriends,
  showCashu,
  showFedimint,
  showFilters,
  setMinReviews,
  setMinRating,
  setOnlyFriends,
  setShowCashu,
  setShowFedimint,
  setShowFilters,
}: FiltersProps) => {
  const loggedIn = useSelector((state: RootState) => state.user.pubkey !== "");

  useEffect(() => {
    if (!loggedIn) {
      setOnlyFriends(false);
    }
  }, [loggedIn]);

  return (
    <>
      <div className={`ml-3 mb-${showFilters ? 1 : 5}`}>
        <button
          className="btn btn-primary underline text-gray-400"
          onClick={() => setShowFilters(!showFilters)}
        >
          Filter
        </button>
      </div>
      {showFilters && (
        <form className="flex flex-col md:flex-row md:justify-start text-gray-400 text-sm">
          <div className="mb-5 ml-3 md:mr-5">
            <div className="mb-1 block">
              <label htmlFor="num-reviews-slider">Total Reviews</label>
            </div>
            <div className="flex">
              <RangeSlider
                value={minReviews}
                onChange={(e) => setMinReviews(Number(e.target.value))}
                id="num-reviews-slider"
                min={0}
                max={10}
                sizing="sm"
              />
              <span className="ml-1 mt-0.5">{minReviews} & up</span>
            </div>
          </div>
          <div className="mb-5 ml-3 md:mr-5">
            <div className="mb-1 block">
              <label htmlFor="avg-rating-slider">Rating</label>
            </div>
            <div className="flex">
              <RangeSlider
                className="custom-range-thumb"
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))}
                id="avg-rating-slider"
                min={0}
                max={5}
                sizing="sm"
              />
              <span className="ml-1 mt-0.5">{minRating} & up</span>
            </div>
          </div>
          <div className="mb-5 ml-3 md:mr-5">
            <div>
              <label htmlFor="only-friends-checkbox">Connections</label>
            </div>
            <div>
              <Checkbox
                id="only-friends-checkbox"
                checked={onlyFriends}
                onChange={(e) => setOnlyFriends(e.target.checked)}
                className="mr-2"
                disabled={!loggedIn}
              />
              <span>1st</span>
            </div>
          </div>
          <div className="mb-5 sm:mb-10 ml-3 md:mr-5">
            <div>
              <label htmlFor="mint-type">Mint Type</label>
            </div>
            <div>
              <Checkbox
                id="mint-type-cashu"
                checked={showCashu}
                onChange={(e) => setShowCashu(!showCashu)}
                className="mr-2"
              />
              <label htmlFor="mint-type-cashu">Cashu</label>
            </div>
            <div>
              <Checkbox
                id="mint-type-fedi"
                checked={showFedimint}
                onChange={(e) => setShowFedimint(!showFedimint)}
                className="mr-2"
              />
              <label htmlFor="mint-type-fedi">Fedimint</label>
            </div>
          </div>
        </form>
      )}
    </>
  );
};

export default MintFilters;
