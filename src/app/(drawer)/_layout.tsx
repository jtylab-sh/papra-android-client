import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  Drawer,
  DrawerContentScrollView,
  DrawerItem,
  DrawerItemList,
  type DrawerContentComponentProps,
} from "expo-router/drawer";
import { type ColorValue, Linking } from "react-native";
import { useTheme } from "react-native-paper";
import { getSettings } from "~/lib/settings";
import { type AppTheme } from "~/constants/theme";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function drawerIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={name} color={color as string} size={size} />
  );
}

async function openInBrowser() {
  const s = await getSettings();
  if (s.serverUrl) await Linking.openURL(s.serverUrl).catch(() => {});
}

export default function DrawerLayout() {
  const theme = useTheme<AppTheme>();
  return (
    <Drawer
      initialRouteName="home"
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        sceneStyle: { backgroundColor: theme.colors.background },
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.onSecondaryContainer,
        drawerActiveBackgroundColor: theme.colors.secondaryContainer,
        drawerInactiveTintColor: theme.colors.onSurfaceVariant,
      }}
      drawerContent={(props: DrawerContentComponentProps) => (
        <DrawerContentScrollView {...props}>
          <DrawerItemList {...props} />
          <DrawerItem
            label="Open in browser"
            icon={drawerIcon("open-in-new")}
            onPress={openInBrowser}
            inactiveTintColor={theme.colors.onSurfaceVariant}
          />
        </DrawerContentScrollView>
      )}
    >
      <Drawer.Screen
        name="home"
        options={{ title: "Home", drawerIcon: drawerIcon("home-outline") }}
      />
      <Drawer.Screen
        name="index"
        options={{
          title: "Documents",
          drawerIcon: drawerIcon("file-document-multiple-outline"),
        }}
      />
      <Drawer.Screen
        name="offline"
        options={{ title: "Offline", drawerIcon: drawerIcon("cloud-check-outline") }}
      />
      <Drawer.Screen
        name="tags"
        options={{ title: "Tags", drawerIcon: drawerIcon("tag-multiple-outline") }}
      />
      <Drawer.Screen
        name="properties"
        options={{ title: "Properties", drawerIcon: drawerIcon("format-list-bulleted-type") }}
      />
      <Drawer.Screen
        name="trash"
        options={{ title: "Trash", drawerIcon: drawerIcon("trash-can-outline") }}
      />
      <Drawer.Screen
        name="settings"
        options={{ title: "Settings", drawerIcon: drawerIcon("cog-outline") }}
      />
    </Drawer>
  );
}
