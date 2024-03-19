import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { setReviewsFilter } from "@/redux/slices/filterSlice";
import { Checkbox, Label } from "flowbite-react";

const ReviewFilters = () => {
  const [onlyFriends, setOnlyFriends] = useState(false);

  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(setReviewsFilter({friends: onlyFriends}))
  }, [onlyFriends]);

  return (
    <form className="mb-3">
      <div>
        <div>
          <Label htmlFor="only-friends-checkbox" value="Only friends"/>
        </div>
        <Checkbox id="only-friends-checkbox" checked={onlyFriends} onChange={(e) => setOnlyFriends(e.target.checked)}/>
      </div>
    </form>
  )
}

export default ReviewFilters;