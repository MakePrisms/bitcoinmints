import userReducer from "./slices/UserSlice";
import { configureStore } from "@reduxjs/toolkit";
import nip87Reducer from "./slices/nip87Slice";
import filtersReducer from "./slices/filterSlice";
import { useDispatch } from "react-redux";

export const store = configureStore({
  reducer: {
    user: userReducer,
    nip87: nip87Reducer,
    filters: filtersReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
