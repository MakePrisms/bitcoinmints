import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface UserState {
  pubkey: string;
  image: string;
  name: string;
  following: string[];
}

const initialState: UserState = {
  pubkey: '',
  image: '',
  name: '',
  following: [],
};

export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<{pubkey: string; image: string; name: string;}>) => {
      state.pubkey = action.payload.pubkey;
      state.image = action.payload.image;
      state.name = action.payload.name;
    },
    setFollowing: (state, action: PayloadAction<string[]>) => {
      state.following = action.payload;
    }
  },
});

export const { setUser, setFollowing } = userSlice.actions;

export default userSlice.reducer;