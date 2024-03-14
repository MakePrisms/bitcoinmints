import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface UserState {
  pubkey: string;
}

const initialState: UserState = {
  pubkey: '',
};

export const userSlice = createSlice({
  name: 'user',
  initialState,
  reducers: {
    setUser: (state, action: PayloadAction<UserState>) => {
      state.pubkey = action.payload.pubkey;
    },
  },
});

export const { setUser } = userSlice.actions;

export default userSlice.reducer;