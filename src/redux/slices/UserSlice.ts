import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface UserState {
  pubkey: string;
  image: string;
  name: string;
}

const initialState: UserState = {
  pubkey: '',
  image: '',
  name: '',
};

export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<UserState>) => {
      state.pubkey = action.payload.pubkey;
      state.image = action.payload.image;
      state.name = action.payload.name;
    },
  },
});

export const { setUser } = userSlice.actions;

export default userSlice.reducer;