import { createSlice } from "@reduxjs/toolkit";

interface FilterState {
  reviews: {
    friends: boolean;
    showCashu: boolean;
    showFedimint: boolean;
  };
  mints: {
    minRating: number;
    minReviews: number;
  };
}

const initialState: FilterState = {
  reviews: {
    friends: false,
    showCashu: true,
    showFedimint: false,
  },
  mints: {
    minRating: 0,
    minReviews: 0,
  },
};

export const filterSlice = createSlice({
  name: "filters",
  initialState,
  reducers: {
    setMintsFilter: (state, action) => {
      state.mints = action.payload;
    },
    setReviewsFilter: (state, action) => {
      state.reviews = action.payload;
    },
  },
});

export const { setMintsFilter, setReviewsFilter } = filterSlice.actions;

export default filterSlice.reducer;
