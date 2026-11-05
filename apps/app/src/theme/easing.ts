import { Easing } from "react-native-reanimated"

/** A strong ease-out for things arriving: quick to respond, soft to settle. */
export const easeOut = Easing.bezier(0.23, 1, 0.32, 1)

/** For things that move or change size while on screen. */
export const easeInOut = Easing.bezier(0.77, 0, 0.175, 1)
