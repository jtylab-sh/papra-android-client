import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { View, type ColorValue } from "react-native";
import { IconButton, useTheme } from "react-native-paper";
import { type AppTheme } from "../../constants/theme";

type IconName = keyof typeof MaterialCommunityIcons.glyphMap;

function drawerIcon(name: IconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <MaterialCommunityIcons name={name} color={color as string} size={size} />
  );
}

export default function DrawerLayout() {
  const theme = useTheme<AppTheme>();
  return (
    <Drawer
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.onSurface,
        sceneStyle: { backgroundColor: theme.colors.background },
        drawerStyle: { backgroundColor: theme.colors.surface },
        drawerActiveTintColor: theme.colors.onSecondaryContainer,
        drawerActiveBackgroundColor: theme.colors.secondaryContainer,
        drawerInactiveTintColor: theme.colors.onSurfaceVariant,
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          title: "Documents",
          drawerIcon: drawerIcon("file-document-multiple-outline"),
          headerRight: () => (
            <View style={{ flexDirection: "row" }}>
              <IconButton
                icon="line-scan"
                onPress={() => router.push({ pathname: "/upload", params: { mode: "scan" } })}
              />
              <IconButton icon="plus" onPress={() => router.push({ pathname: "/upload", params: { mode: "pick" } })} />
            </View>
          ),
        }}
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
