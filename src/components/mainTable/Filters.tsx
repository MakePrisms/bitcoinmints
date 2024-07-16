import { RootState } from "@/redux/store";
import { Checkbox, RangeSlider } from "flowbite-react";
import { useSelector } from "react-redux";
import useMintData from "@/hooks/useMintData";

interface FiltersProps {
  showFilters: boolean;
  setShowFilters: (showFilters: boolean) => void;
}

const MintFilters = ({ showFilters, setShowFilters }: FiltersProps) => {
  const loggedIn = useSelector((state: RootState) => state.user.pubkey !== "");
  const { filters, updateFilters } = useMintData();

  const handleShowTypeChange = (show: "cashu" | "fedimint") => {
    if (show === "cashu") {
      updateFilters({ showCashu: !filters.showCashu });
    } else {
      updateFilters({ showFedimint: !filters.showFedimint });
    }
  };

  const handleUnitChange = (unit: string) => {
    const newUnits = filters.units.includes(unit)
      ? filters.units.filter((u) => u !== unit)
      : [...filters.units, unit];
    updateFilters({ units: newUnits });
  };

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
                value={filters.minReviews}
                onChange={(e) =>
                  updateFilters({ minReviews: Number(e.target.value) })
                }
                id="num-reviews-slider"
                min={0}
                max={10}
                sizing="sm"
              />
              <span className="ml-1 mt-0.5">{filters.minReviews} & up</span>
            </div>
          </div>
          <div className="mb-5 ml-3 md:mr-5">
            <div className="mb-1 block">
              <label htmlFor="avg-rating-slider">Rating</label>
            </div>
            <div className="flex">
              <RangeSlider
                className="custom-range-thumb"
                value={filters.minRating}
                onChange={(e) =>
                  updateFilters({ minRating: Number(e.target.value) })
                }
                id="avg-rating-slider"
                min={0}
                max={5}
                sizing="sm"
              />
              <span className="ml-1 mt-0.5">{filters.minRating} & up</span>
            </div>
          </div>
          <div className="mb-5 ml-3 md:mr-5">
            <div>
              <label htmlFor="only-friends-checkbox">Connections</label>
            </div>
            <div>
              <Checkbox
                id="only-friends-checkbox"
                checked={filters.onlyFriends}
                onChange={(e) =>
                  updateFilters({ onlyFriends: e.target.checked })
                }
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
                checked={filters.showCashu}
                onChange={() => handleShowTypeChange("cashu")}
                className="mr-2"
              />
              <label htmlFor="mint-type-cashu">Cashu</label>
            </div>
            <div>
              <Checkbox
                id="mint-type-fedi"
                checked={filters.showFedimint}
                onChange={() => handleShowTypeChange("fedimint")}
                className="mr-2"
              />
              <label htmlFor="mint-type-fedi">Fedimint</label>
            </div>
          </div>
          <div>
            <div>
              <label htmlFor="units">Units</label>
              <div>
                <Checkbox
                  id="unit-sat"
                  checked={filters.units.includes("sat")}
                  onChange={() => handleUnitChange("sat")}
                  className="mr-2"
                />
                <label htmlFor="unit-sat">Sats</label>
              </div>
              <div>
                <Checkbox
                  id="unit-usd"
                  checked={filters.units.includes("usd")}
                  onChange={() => handleUnitChange("usd")}
                  className="mr-2"
                />
                <label htmlFor="unit-usd">USD</label>
              </div>
            </div>
          </div>
        </form>
      )}
    </>
  );
};

export default MintFilters;
