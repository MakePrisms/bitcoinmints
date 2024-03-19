import React, { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { Label, RangeSlider } from "flowbite-react";
import { useDispatch } from "react-redux";
import { setMintsFilter } from "@/redux/slices/filterSlice";

const MintFilters = () => {
  const [minRecs, setMinRecs] = useState(0);
  const [minRating, setMinRating] = useState(0);

  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(setMintsFilter({minRecs, minRating}))
  }, [minRecs, minRating]);

  return (
    <form className="flex justify-around mb-3">
      <div>
        <div className="mb-1 block">
          <Label htmlFor="num-recs-slider" value="Min. total reviews"/>
        </div>
        <div className="flex">
        <RangeSlider value={minRecs} onChange={(e) => setMinRecs(Number(e.target.value))} id="num-recs-slider" min={0} max={10}/>
        <span className="ml-1">{minRecs}</span>
        </div>
      </div> 
      <div>
        <div className="mb-1 block">
          <Label htmlFor="avg-rating-slider" value="Min. avg. rating"/>
        </div>
        <div className="flex">
        <RangeSlider value={minRating} onChange={(e) => setMinRating(Number(e.target.value))} id="avg-rating-slider" min={0} max={5}/>
        <span className="ml-1">{minRating}</span>
        </div>
      </div>
    </form>
  );
}

export default MintFilters;;